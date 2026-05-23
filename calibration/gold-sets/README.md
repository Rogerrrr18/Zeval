# Gold Sets

`gold-sets/` 存放人工审核后的标准案例。

约定：
- 一个版本一个目录，例如 `v1/`
- `cases.jsonl` 存原始案例与 transcript
- `labels.jsonl` 存人工共识标签
- `annotation-tasks.jsonl` 存 v2+ 的可分工标注任务索引
- `label-drafts/` 存 v2+ 的人工作业草稿，审核通过后再导入
- 新增版本时不要覆盖旧版本，直接创建 `v2/`、`v3/`
