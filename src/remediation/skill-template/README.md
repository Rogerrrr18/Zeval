# remediation-skill-template

Zeval 调优包会渲染为 Claude Code / Codex skill 文件夹：

```text
remediation-skill-<packageId>/
  SKILL.md
  reference/
    issue-brief.md
    badcases.jsonl
    remediation-spec.yaml
    acceptance-gate.yaml
  README.md
```

模板文件只描述结构；实际内容由 `src/remediation/builder.ts` 基于评估结果动态生成。

