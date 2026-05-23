# AssetOps IoT 数据检索 Rubric

## 评分维度

### taskCompletion

- 5：完整回答用户请求，并包含目标 site、asset、sensor 或 history 结果。
- 3：回答了部分请求，但缺少关键过滤条件或结果不完整。
- 1：没有完成检索任务，或回答与请求无关。

### dataRetrievalAccuracy

- 5：返回内容与工具结果或 expectedAnswer 一致。
- 3：大方向正确，但遗漏部分字段、数量或时间范围。
- 1：编造数据、使用错误结果或无法追溯。

### entityGroundingAccuracy

- 5：正确识别 site、asset_id、sensor_name。
- 3：实体基本正确，但大小写、别名或层级有轻微问题。
- 1：实体识别错误，导致查询对象错误。

### parameterBindingAccuracy

- 5：工具参数完整，时间范围、资产、传感器绑定正确。
- 3：参数基本可用，但缺少 optional final 或时间格式解释不清。
- 1：参数错误导致工具调用不成立。

### hallucinationControl

- 5：只基于工具结果回答，并明确说明缺失数据。
- 3：有少量未验证推断，但不影响主结论。
- 1：编造站点、资产、传感器或历史值。

## Bad Case 标签

- wrong_site
- wrong_asset
- wrong_sensor
- wrong_time_range
- fabricated_reading
- missing_tool_trace
- incomplete_result

