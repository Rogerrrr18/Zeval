# mock-customer-api

该目录用于模拟“客户侧交互产品 API”。

当前提供两个示例：

1. `customer-demo-api.mjs`
   - 固定规则回包
   - 用于本地联调和接口演示
2. `siliconflow-customer-api.mjs`
   - 直接调用 `SiliconFlow`
   - 默认读取项目根目录的 `\.env.local`
   - 若没有 `\.env.local`，则回退读取根目录的 `\.env.example`

## 统一接口约定

两个示例 API 都暴露：

- `POST /reply`

请求体示例：

```json
{
  "messages": [
    { "role": "user", "content": "我今天很焦虑，主管说我表达很乱。" }
  ],
  "userQuery": "你能帮我整理一下该怎么和主管沟通吗？",
  "metadata": {
    "caseId": "bc_0001",
    "sampleBatchId": "sample_001"
  }
}
```

返回体示例：

```json
{
  "reply": "可以，我们先把你最想表达的一句话整理出来。",
  "provider": "mock-demo",
  "model": "rule-based",
  "latencyMs": 12
}
```

## 运行方式

### 1. 启动固定规则版

```powershell
node "D:/AI_project/zerore-eval-system/mock-customer-api/customer-demo-api.mjs"
```

### 2. 启动 SiliconFlow 代理版

```powershell
node "D:/AI_project/zerore-eval-system/mock-customer-api/siliconflow-customer-api.mjs"
```

## 说明

- 当前不会把真实密钥硬编码进仓库文件
- 但 `siliconflow-customer-api.mjs` 会直接读取根目录已有环境变量配置
- 因此你本地现有配置不变时，可以直接把它当作“带 key 的客户侧示例 API”使用
