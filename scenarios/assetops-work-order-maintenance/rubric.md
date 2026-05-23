# AssetOps 工单与维护分析 Rubric

## 评分维度

### workOrderRecordAccuracy

- 5：工单数量、类型、字段和过滤范围正确。
- 3：主结果正确但存在轻微遗漏。
- 1：工单数据错误或编造。

### equipmentTimeFilterCorrectness

- 5：equipment_id、start_date、end_date 绑定正确。
- 3：设备正确但时间范围或格式有轻微问题。
- 1：设备或时间范围错误。

### maintenanceEventReasoning

- 5：能把工单、告警、异常和维护事件建立合理因果/时间关系。
- 3：能描述事件，但推理深度不足。
- 1：事件关系错误。

### failureCodeInterpretation

- 5：正确解释 failure code 的类别和含义。
- 3：能列出 code，但解释不充分。
- 1：误读或编造 code。

### actionability

- 5：输出可以指导维护排期、复核或升级。
- 3：建议可用但不够具体。
- 1：建议空泛或与证据不一致。

## Bad Case 标签

- wrong_equipment_id
- wrong_date_filter
- wrong_work_order_count
- failure_code_misread
- weak_maintenance_reasoning
- unactionable_recommendation

