import siliconflow from "../src/lib/siliconflow.ts";

const requirementText =
  "我是做外贸ai客服的，需要在shopify上自动回复用户，我们的业务比较关注是否能接住用户问题、安抚用户情绪并给出解决方案，还有关注转人工率以及回复内容是否准确（参考了我们的回答示例）";
const raw = await siliconflow.requestSiliconFlowChatCompletion(
  [
    {
      role: "system",
      content: "Return JSON only. Output schema: {\"title\":\"x\",\"modules\":[]}",
    },
    {
      role: "user",
      content: requirementText,
    },
  ],
  { stage: "benchmark_rubric_draft_debug", temperature: 0.2, seed: 42 },
);

console.log("--- RAW START ---");
console.log(raw.slice(0, 2000));
console.log("--- RAW END ---");
try {
  const parsed = siliconflow.parseJsonObjectFromLlmOutput(raw);
  console.log("PARSE OK", typeof parsed);
} catch (error) {
  console.log("PARSE FAIL", error instanceof Error ? error.message : error);
}
