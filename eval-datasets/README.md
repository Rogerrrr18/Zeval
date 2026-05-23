# eval-datasets

该目录用于存放第一阶段文件系统版评测集资产。

当前设计目标：

- 先用文件系统跑通评测集 MVP
- 保持数据结构稳定
- 通过 `DatasetStore` 抽象，后续可平滑迁移到数据库

当前约定：

- `goodcase/`：高质量案例集
- `badcase/`：低质量案例集
- `runs/`：每次批量跑分结果
- `samples/`：临时评测集抽样结果
- `indexes/`：给 PM/运营查看的总索引
- `schema/`：文件结构说明
