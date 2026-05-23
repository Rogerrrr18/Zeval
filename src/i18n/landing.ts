/**
 * @fileoverview Bilingual (zh/en) copy dictionary for the public landing page.
 */

export type Locale = "zh" | "en";

export type LandingCapability = {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
};

export type LandingLoopStep = {
  step: string;
  description: string;
};

export type LandingOutcome = {
  title: string;
  text: string;
};

export type LandingIntegration = {
  title: string;
  text: string;
  code: string;
};

export type LandingFaqItem = {
  question: string;
  answer: string;
};

export type LandingHeroStat = {
  label: string;
  value: string;
};

export type LandingFooterColumn = {
  title: string;
  links: { label: string; href: string }[];
};

export type LandingCopy = {
  nav: { label: string; href: string }[];
  ctaPrimary: string;
  ctaSecondary: string;
  ctaTertiary: string;
  langSwitch: { label: string; switchTo: string };
  hero: {
    eyebrow: string;
    headline: string;
    lead: string;
    stats: LandingHeroStat[];
    previewLabel: string;
    preview: {
      ingestLabel: string;
      ingestTitle: string;
      ingestText: string;
      formats: string[];
      scoreLabel: string;
      score: string;
      scoreText: string;
      traceLabel: string;
      trace: string[];
      packageLabel: string;
      packageTitle: string;
      packageText: string;
    };
  };
  capabilitiesSection: { eyebrow: string; title: string; lead: string };
  capabilities: LandingCapability[];
  loopSection: { eyebrow: string; title: string };
  loopSteps: LandingLoopStep[];
  integrationSection: { eyebrow: string; title: string; lead: string };
  integrations: LandingIntegration[];
  outcomesSection: { eyebrow: string; title: string };
  outcomes: LandingOutcome[];
  faqSection: { eyebrow: string; title: string };
  faq: LandingFaqItem[];
  cta: { eyebrow: string; title: string; lead: string };
  footer: {
    tagline: string;
    columns: LandingFooterColumn[];
    copyright: (year: number) => string;
    builtFor: string;
  };
};

const ZH: LandingCopy = {
  nav: [
    { label: "工作台", href: "/workbench" },
    { label: "接入方式", href: "#integration" },
    { label: "案例池", href: "/datasets" },
    { label: "调优包", href: "/remediation-packages" },
    { label: "在线评测", href: "/online-eval" },
  ],
  ctaPrimary: "打开工作台",
  ctaSecondary: "查看在线评测",
  ctaTertiary: "查看调优包",
  langSwitch: { label: "中", switchTo: "EN" },
  hero: {
    eyebrow: "AI Conversation Quality Loop",
    headline: "把 AI 对话失败，变成下一次发版前的回归测试。",
    lead:
      "Zeval 接收 CSV / JSON / TXT / MD 对话日志，自动完成解析、评估、证据提取、bad case 归档、调优包生成和回放验证。它不是单纯看分数的 dashboard，而是一条能让产品和工程一起修问题的质量闭环。",
    stats: [
      { label: "输入", value: "CSV / JSON / TXT / MD" },
      { label: "评估", value: "客观指标 + LLM Judge" },
      { label: "输出", value: "图表 / 证据 / 建议 / bad case" },
      { label: "闭环", value: "baseline + package + replay" },
    ],
    previewLabel: "Zeval product preview",
    preview: {
      ingestLabel: "INGEST",
      ingestTitle: "chatlog upload",
      ingestText: "字段映射、标准化、topic segment 和情绪基线自动生成。",
      formats: ["CSV", "JSON", "TXT", "MD"],
      scoreLabel: "QUALITY SIGNAL",
      score: "72.4",
      scoreText: "共情恢复不足，答非所问风险偏高。",
      traceLabel: "RECOVERY TRACE",
      trace: ["T3 用户情绪转负", "T5 assistant 解释过长", "T7 用户停止追问"],
      packageLabel: "NEXT ACTION",
      packageTitle: "remediation package",
      packageText: "issue brief、badcases、acceptance gate 已可交给 Codex / Claude Code 执行。",
    },
  },
  capabilitiesSection: {
    eyebrow: "Product Surfaces",
    title: "首页要讲清楚的不是愿景，而是现在能跑的链路。",
    lead:
      "当前项目已经从单次上传评估扩展到了数据集、基线、调优包、回放验证和 Chat 辅助复盘。landing page 应该直接把这个进展转化成可信的产品叙事。",
  },
  capabilities: [
    {
      eyebrow: "01 / Workbench",
      title: "上传对话，直接得到可解释评估结果",
      description:
        "工作台负责文件上传、字段识别、流式评估进度、指标摘要、图表、建议和 baseline 保存，是当前最重要的演示入口。",
      bullets: ["支持 CSV / JSON / TXT / MD", "返回 meta + metrics + charts + suggestions", "LLM 不可用时保留客观指标并显式降级"],
    },
    {
      eyebrow: "02 / Dataset",
      title: "把失败会话沉淀为可复用 case pool",
      description:
        "bad case 不再只是一次报告里的截图，而是可以被归档、标记、去重、抽样和回归验证的长期资产。",
      bullets: ["topic-level bad case harvest", "自动风险信号 + 手动 false-positive override", "sample batch 支持固定回归集合"],
    },
    {
      eyebrow: "03 / Remediation",
      title: "从发现问题走到可执行修复任务",
      description:
        "调优包会把 issue brief、badcases、修复规格和验收门槛打包，交给 Coding Agent 修改 prompt、policy、orchestration 或代码。",
      bullets: ["issue-brief.md", "remediation-spec.yaml", "badcases.jsonl + acceptance-gate.yaml"],
    },
    {
      eyebrow: "04 / Online Eval",
      title: "改完以后，用 replay 证明真的变好",
      description:
        "在线评测把当前行为与历史 baseline 做对照，避免只看主观感觉发版，并为后续 release gate 留接口。",
      bullets: ["customer reply API replay", "current-vs-baseline 对比", "validation runner 支持 offline / replay 两类验证"],
    },
  ],
  loopSection: {
    eyebrow: "Loop",
    title: "Zeval 的产品逻辑是质量闭环，不是评估面板。",
  },
  loopSteps: [
    { step: "接收原始日志", description: "先用低门槛文件上传跑通，再逐步接 REST / SDK。" },
    { step: "标准化对话", description: "parser、normalizer、segmenter 把脏 chatlog 变成统一结构。" },
    { step: "计算质量信号", description: "客观指标稳定计算，主观指标输出 score / reason / evidence / confidence。" },
    { step: "生成修复资产", description: "bad case 进入 case pool，并被编译成 agent-readable 调优包。" },
    { step: "回放验证结果", description: "保存 baseline，用 replay / offline validation 判断修复是否通过。" },
  ],
  integrationSection: {
    eyebrow: "Supported Integrations",
    title: "当前支持的 4 种接入方式。",
    lead:
      "从低门槛文件上传开始验证，也可以直接接 API、trace ingest 或 SDK / CLI 示例，把评估结果接进内部系统、发版检查和 Agent 修复流程。",
  },
  integrations: [
    {
      title: "文件上传",
      text: "CSV / JSON / TXT / MD 对话日志直接进入工作台，适合客户样例、内部复盘和快速演示。",
      code: "/workbench",
    },
    {
      title: "评估 API",
      text: "将标准 rawRows 发送到评估接口，返回 meta、指标、图表、证据、建议和调优包入口。",
      code: "POST /api/evaluate",
    },
    {
      title: "Trace ingest",
      text: "把线上 Agent 运行轨迹写入系统，后续可用于 bad case 归档、baseline 对比和质量回放。",
      code: "POST /api/traces/ingest",
    },
    {
      title: "SDK / CLI / Agent 包",
      text: "通过示例 SDK、CLI 和 remediation package，把评估结果交给 Codex / Claude Code 执行修复。",
      code: "SDK / CLI -> package -> replay",
    },
  ],
  outcomesSection: {
    eyebrow: "Positioning",
    title: "面向 AI Agent 产品团队的失败对话运营系统。",
  },
  outcomes: [
    { title: "给产品", text: "快速回答哪一轮坏了、用户为什么掉线、哪些建议可以马上改。" },
    { title: "给工程", text: "把模糊体验问题翻译成有 evidence 和 acceptance gate 的修复任务。" },
    { title: "给团队 leader", text: "用 baseline 和回放验证约束发版质量，让每次失败都沉淀成测试资产。" },
  ],
  faqSection: { eyebrow: "FAQ", title: "当前阶段应该怎么理解 Zeval？" },
  faq: [
    {
      question: "Zeval 现在是平台还是 MVP？",
      answer:
        "当前定位应该坦诚表达为 MVP 质量闭环，不是大而全平台。优势是上传、评估、bad case、调优包、回放验证这条链路已经可以演示和迭代。",
    },
    {
      question: "为什么不把 landing page 做成通用 eval SaaS？",
      answer:
        "通用 eval SaaS 叙事太容易撞车。Zeval 更锋利的定位是把真实失败对话转成下一次发版前的修复任务和回归测试。",
    },
    {
      question: "LLM Judge 不稳定怎么办？",
      answer:
        "评估链路采用规则优先、LLM 辅助。主观评估必须输出 score / reason / evidence / confidence；LLM 不可用时保留客观指标并标记降级。",
    },
    {
      question: "第一版客户该怎么试？",
      answer:
        "最小路径是准备一批真实 chatlog，上传到工作台，查看核心指标、证据和建议，再生成调优包交给 agent 或工程师执行。",
    },
  ],
  cta: {
    eyebrow: "Run The Loop",
    title: "拿一批真实对话，先把失败定位出来。",
    lead:
      "从工作台开始跑通 MVP。先证明 Zeval 能把坏对话变成可行动任务，再考虑 SDK、队列、CI gate 和更完整的部署。",
  },
  footer: {
    tagline: "AI conversation quality loop for teams shipping agent products.",
    columns: [
      {
        title: "产品",
        links: [
          { label: "工作台", href: "/workbench" },
          { label: "案例池", href: "/datasets" },
          { label: "调优包", href: "/remediation-packages" },
          { label: "在线评测", href: "/online-eval" },
        ],
      },
      {
        title: "开发",
        links: [
          { label: "Chat Copilot", href: "/chat" },
          { label: "Integrations", href: "/integrations" },
          { label: "Docs API", href: "/api/docs" },
        ],
      },
      {
        title: "资源",
        links: [
          { label: "API Docs", href: "/api/docs" },
          { label: "Demo CSV", href: "/sample-data/ecommerce-angry-escalation.csv" },
        ],
      },
    ],
    copyright: (year) => `© ${year} Zeval.`,
    builtFor: "为正在交付 AI Agent 产品的团队而建。",
  },
};

const EN: LandingCopy = {
  nav: [
    { label: "Workbench", href: "/workbench" },
    { label: "Integrations", href: "#integration" },
    { label: "Case pool", href: "/datasets" },
    { label: "Packages", href: "/remediation-packages" },
    { label: "Online eval", href: "/online-eval" },
  ],
  ctaPrimary: "Open workbench",
  ctaSecondary: "View online eval",
  ctaTertiary: "View packages",
  langSwitch: { label: "EN", switchTo: "中" },
  hero: {
    eyebrow: "AI Conversation Quality Loop",
    headline: "Turn failed AI conversations into regression tests before the next release.",
    lead:
      "Zeval takes CSV / JSON / TXT / MD chat logs and runs parsing, evaluation, evidence extraction, bad-case storage, remediation packages, and replay validation. It is not just a scoring dashboard. It is a quality loop PMs and engineers can use to fix real failures.",
    stats: [
      { label: "Inputs", value: "CSV / JSON / TXT / MD" },
      { label: "Evaluation", value: "Objective metrics + LLM Judge" },
      { label: "Outputs", value: "Charts / evidence / suggestions / bad cases" },
      { label: "Loop", value: "baseline + package + replay" },
    ],
    previewLabel: "Zeval product preview",
    preview: {
      ingestLabel: "INGEST",
      ingestTitle: "chatlog upload",
      ingestText: "Field mapping, normalization, topic segments, and emotion baselines are generated automatically.",
      formats: ["CSV", "JSON", "TXT", "MD"],
      scoreLabel: "QUALITY SIGNAL",
      score: "72.4",
      scoreText: "Weak empathy recovery with elevated off-topic risk.",
      traceLabel: "RECOVERY TRACE",
      trace: ["T3 user sentiment turns negative", "T5 assistant over-explains", "T7 user stops asking"],
      packageLabel: "NEXT ACTION",
      packageTitle: "remediation package",
      packageText: "Issue brief, bad cases, and acceptance gate are ready for Codex / Claude Code.",
    },
  },
  capabilitiesSection: {
    eyebrow: "Product Surfaces",
    title: "The landing page should sell the runnable loop, not a vague platform promise.",
    lead:
      "The current product already goes beyond one-off evaluation: workbench, datasets, baselines, remediation packages, replay validation, and Chat-assisted review.",
  },
  capabilities: [
    {
      eyebrow: "01 / Workbench",
      title: "Upload transcripts and get explainable evaluation results",
      description:
        "The workbench is the main demo path: file upload, field detection, streamed progress, metric summaries, charts, suggestions, and baseline saves.",
      bullets: ["CSV / JSON / TXT / MD support", "Returns meta + metrics + charts + suggestions", "Keeps objective metrics when LLM judging degrades"],
    },
    {
      eyebrow: "02 / Dataset",
      title: "Persist failed sessions as reusable case assets",
      description:
        "Bad cases should not disappear inside a report. They become assets that can be deduped, sampled, overridden, and reused for regression.",
      bullets: ["Topic-level bad case harvest", "Automatic risk signals + manual false-positive override", "Sample batches for fixed regression sets"],
    },
    {
      eyebrow: "03 / Remediation",
      title: "Move from finding issues to executable fix tasks",
      description:
        "Packages compile issue briefs, bad cases, remediation specs, and acceptance gates so a coding agent can edit prompt, policy, orchestration, or code.",
      bullets: ["issue-brief.md", "remediation-spec.yaml", "badcases.jsonl + acceptance-gate.yaml"],
    },
    {
      eyebrow: "04 / Online Eval",
      title: "After the fix, replay proves whether quality improved",
      description:
        "Online eval compares current behavior against saved baselines, replacing subjective release judgment with replay and offline validation.",
      bullets: ["Customer reply API replay", "Current-vs-baseline comparison", "Validation runner supports offline and replay checks"],
    },
  ],
  loopSection: {
    eyebrow: "Loop",
    title: "Zeval is a quality loop, not an evaluation panel.",
  },
  loopSteps: [
    { step: "Receive raw logs", description: "Start with low-friction uploads, then move to REST or SDK integration." },
    { step: "Normalize conversations", description: "Parser, normalizer, and segmenter turn messy chat logs into a canonical structure." },
    { step: "Compute signals", description: "Objective metrics are deterministic, while subjective metrics include score, reason, evidence, and confidence." },
    { step: "Create fix assets", description: "Bad cases enter the case pool and compile into agent-readable remediation packages." },
    { step: "Replay validation", description: "Saved baselines, replay, and offline validation decide whether the fix passes." },
  ],
  integrationSection: {
    eyebrow: "Supported Integrations",
    title: "Four integration paths currently supported.",
    lead:
      "Start with low-friction file uploads, or connect through APIs, trace ingest, and SDK / CLI examples to bring evaluation into internal tools, release checks, and agent remediation workflows.",
  },
  integrations: [
    {
      title: "File upload",
      text: "Drop CSV / JSON / TXT / MD chat logs into the workbench for customer samples, internal reviews, and quick demos.",
      code: "/workbench",
    },
    {
      title: "Evaluation API",
      text: "Send canonical rawRows to the evaluation endpoint and receive meta, metrics, charts, evidence, suggestions, and package entry points.",
      code: "POST /api/evaluate",
    },
    {
      title: "Trace ingest",
      text: "Write production Agent traces into Zeval for bad-case storage, baseline comparisons, and quality replay.",
      code: "POST /api/traces/ingest",
    },
    {
      title: "SDK / CLI / Agent package",
      text: "Use SDK and CLI examples plus remediation packages to hand evaluation results to Codex / Claude Code.",
      code: "SDK / CLI -> package -> replay",
    },
  ],
  outcomesSection: {
    eyebrow: "Positioning",
    title: "Failure-ops for teams shipping AI Agent products.",
  },
  outcomes: [
    { title: "For PMs", text: "Answer which turn broke, why the user dropped, and which fixes can ship now." },
    { title: "For engineers", text: "Translate fuzzy experience issues into evidence-backed tasks with acceptance gates." },
    { title: "For team leads", text: "Use baselines and replay validation to turn every failure into a reusable test asset." },
  ],
  faqSection: { eyebrow: "FAQ", title: "How to understand Zeval at this stage" },
  faq: [
    {
      question: "Is Zeval a platform or an MVP?",
      answer:
        "It should be positioned honestly as an MVP quality loop. The strength is that upload, evaluation, bad cases, packages, and replay validation can already be demonstrated and iterated.",
    },
    {
      question: "Why not position it as a generic eval SaaS?",
      answer:
        "Generic eval SaaS positioning is crowded. Zeval is sharper when it turns real failed conversations into fix tasks and regression tests before the next release.",
    },
    {
      question: "What if the LLM Judge is unstable?",
      answer:
        "The pipeline is rules-first with LLM assistance. Subjective metrics must include score, reason, evidence, and confidence; if LLM judging is unavailable, objective metrics remain and degradation is explicit.",
    },
    {
      question: "How should a first customer try it?",
      answer:
        "Bring real chat logs into the workbench, inspect metrics, evidence, and suggestions, then generate a remediation package for an agent or engineer to execute.",
    },
  ],
  cta: {
    eyebrow: "Run The Loop",
    title: "Start with real conversations and locate the failures.",
    lead:
      "Use the workbench to prove the MVP first. Once Zeval turns bad conversations into actionable tasks, move into SDKs, queues, CI gates, and fuller deployment.",
  },
  footer: {
    tagline: "AI conversation quality loop for teams shipping agent products.",
    columns: [
      {
        title: "Product",
        links: [
          { label: "Workbench", href: "/workbench" },
          { label: "Case pool", href: "/datasets" },
          { label: "Packages", href: "/remediation-packages" },
          { label: "Online eval", href: "/online-eval" },
        ],
      },
      {
        title: "Build",
        links: [
          { label: "Chat Copilot", href: "/chat" },
          { label: "Integrations", href: "/integrations" },
          { label: "Docs API", href: "/api/docs" },
        ],
      },
      {
        title: "Resources",
        links: [
          { label: "API Docs", href: "/api/docs" },
          { label: "Demo CSV", href: "/sample-data/ecommerce-angry-escalation.csv" },
        ],
      },
    ],
    copyright: (year) => `© ${year} Zeval.`,
    builtFor: "Built for teams shipping AI Agent products.",
  },
};

export const LANDING_COPY: Record<Locale, LandingCopy> = { zh: ZH, en: EN };
