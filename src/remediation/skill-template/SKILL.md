# {{title}}

## 什么时候使用

当 Zeval 评估结果发现可复现 bad case，并需要把问题交给 Claude Code / Codex 修复时使用。

## 修复策略

- 优先处理覆盖面最大的失败标签。
- 只修改 remediation-spec.yaml 限定的 edit_scope。
- 不做无关重构。

## 验收标准

- replay gate 通过。
- offline eval 不出现超过阈值的 regression。
- badcases.jsonl 中的关键样例不再触发同类失败。

