# AssetOps 多 Agent 端到端编排 Rubric

## 评分维度

### planningCompleteness

- 5：计划覆盖检索、诊断、预测、维护建议等必要步骤。
- 3：计划覆盖主要步骤，但缺少依赖或校验。
- 1：没有有效计划或步骤错乱。

### agentSequenceCorrectness

- 5：IoT/FMSR/TSFM/WO/Vibration 调用顺序符合任务依赖。
- 3：顺序基本可用但有冗余或轻微错位。
- 1：先后关系错误，导致结果不可靠。

### toolSelectionCorrectness

- 5：每一步选择正确工具。
- 3：工具方向正确但不是最合适。
- 1：关键工具选错或没调用。

### evidenceChainCompleteness

- 5：最终结论能追溯到每一步工具结果。
- 3：证据链部分完整。
- 1：结论无法追溯。

### recoveryFromToolFailure

- 5：工具失败时明确降级、重试或请求补充数据。
- 3：能提示失败但恢复不足。
- 1：忽略工具失败并继续编造。

## Bad Case 标签

- incomplete_plan
- wrong_agent_sequence
- wrong_tool_selection
- broken_evidence_chain
- ignored_tool_failure
- fabricated_synthesis

