# chatlog 评估维度.xlsx

> 自动转换自 XLSX（包含全部子表）

## 子表目录

- 1. 指标总览
- 2. 时间维度指标
- 3. 情绪维度指标
- 4. 交互断点指标
- 5. 对话质量指标
- 6. 用户参与度指标
- 7. 问题诊断指标
- 8. 可视化建议

## Sheet 1: 指标总览

| 类别 | 指标名称 | 优先级 | 计算复杂度 | 核心洞察 |
| --- | --- | --- | --- | --- |
| 时间维度 | 对话深度分布 | 高 | 低 | 用户在哪一轮大量流失 |
| 时间维度 | 响应时间间隔 | 中 | 低 | 用户思考时间越长可能越困惑 |
| 时间维度 | 对话时长 | 中 | 低 | 过短没吸引力过长效率低 |
| 时间维度 | 活跃时段热力图 | 低 | 中 | 用户什么时间最需要陪伴 |
| 情绪维度 | 情绪曲线 | 高 | 低 | 情绪是上升还是下降 |
| 情绪维度 | 情绪波动幅度 | 中 | 低 | 波动太大说明不稳定 |
| 情绪维度 | 情绪拐点 | 高 | 中 | 哪轮对话改变了用户心情 |
| 情绪维度 | 峰值情绪时刻 | 中 | 中 | 做对了什么或做错了什么 |
| 情绪维度 | 情绪恢复时间 | 中 | 中 | 共情能力够不够快 |
| 交互断点 | 断点位置 | 高 | 低 | 大部分用户在第几轮离开 |
| 交互断点 | 断点前情绪 | 高 | 低 | 是带着负面情绪离开的吗 |
| 交互断点 | 断点前 AI 行为 | 高 | 中 | 最后一轮 AI 的回应类型 |
| 交互断点 | 沉默时长 | 中 | 中 | 是暂时离开还是永久流失 |
| 交互断点 | 断点聚类 | 高 | 中 | 找到死亡轮次 |
| 对话质量 | 话题切换频率 | 中 | 中 | 切换太快没深度太慢无聊 |
| 对话质量 | 用户主动提问比例 | 中 | 低 | 用户好奇等于投入度高 |
| 对话质量 | AI 主导 vs 用户主导 | 中 | 低 | 1:1 最理想 |
| 对话质量 | 用户输入长度趋势 | 高 | 低 | 越来越短等于失去兴趣 |
| 对话质量 | AI 回应长度 | 中 | 低 | 太长压迫感太短敷衍 |
| 对话质量 | 共情语句密度 | 高 | 低 | 共情词比例 |
| 用户参与度 | 个人信息分享度 | 高 | 中 | 愿意分享等于信任建立 |
| 用户参与度 | 表情 emoji 使用率 | 中 | 低 | 情绪投入度 |
| 用户参与度 | 用户重复问题次数 | 中 | 低 | AI 没听懂 |
| 用户参与度 | 用户困惑表达 | 中 | 低 | AI 表达不清晰 |
| 用户参与度 | 24 小时返回率 | 高 | 中 | 真正的留存指标 |
| 问题诊断 | 说教检测 | 高 | 低 | 说教太多用户反感 |
| 问题诊断 | 无视检测 | 高 | 中 | AI 没理解用户 |
| 问题诊断 | 重复检测 | 中 | 低 | 模型多样性不够 |
| 问题诊断 | 最佳实践对话 | 高 | 高 | 复制成功模式 |
| 问题诊断 | 负面模式识别 | 高 | 高 | 避免失败模式 |

## Sheet 2: 时间维度指标

| 指标名称 | 计算方法 | Python 代码示例 | 业务洞察 | 优先级 |
| --- | --- | --- | --- | --- |
| 对话深度分布 | 统计 1 轮/3 轮/5 轮+/10 轮 + 对话占比 | depths = [len(c.messages) for c in convs]
Counter(depths) | 用户在哪一轮大量流失？找到流失高峰轮次 | 高 |
| 响应时间间隔 | 用户两次消息之间的时间差（秒） | gaps = [t[i+1]-t[i] for i in range(len(t)-1)]
avg_gap = mean(gaps) | 用户思考时间越长，可能越困惑或犹豫 | 中 |
| 对话时长 | 从开场到结束的总时长（分钟） | duration = (last_msg.time - first_msg.time) / 60 | 过短（<1 分钟）= 没吸引力，过长（>30 分钟）= 效率低 | 中 |
| 活跃时段热力图 | 按小时统计对话数量 | hours = [msg.hour for msg in messages]
Counter(hours) | 用户什么时间最需要陪伴？优化运营时间 | 低 |

## Sheet 3: 情绪维度指标

| 指标名称 | 计算方法 | Python 代码示例 | 业务洞察 | 优先级 |
| --- | --- | --- | --- | --- |
| 情绪曲线 | 每轮对话的情感分数连线 | scores = [sentiment(m.content) for m in messages] | 情绪是上升还是下降？整体趋势如何 | 高 |
| 情绪波动幅度 | 最高分 - 最低分 | volatility = max(scores) - min(scores) | 波动太大 = 不稳定，用户体验不一致 | 中 |
| 情绪拐点 | 情绪从正转负/从负转正的节点 | for i in range(1, len-1):
  if scores[i-1]<scores[i]>scores[i+1]: peak | 哪轮对话改变了用户心情？做对/做错了什么 | 高 |
| 峰值情绪时刻 | 情绪最高/最低的那轮对话 | peak_idx = scores.index(max(scores))
peak_msg = messages[peak_idx] | 做对了什么（峰值）/做错了什么（谷值） | 中 |
| 情绪恢复时间 | 负面情绪持续到恢复中性的轮次 | for i in range(start, len):
  if scores[i] > 0: return i-start | 共情能力够不够快？恢复越短越好 | 中 |

## Sheet 4: 交互断点指标

| 指标名称 | 计算方法 | Python 代码示例 | 业务洞察 | 优先级 |
| --- | --- | --- | --- | --- |
| 断点位置 | 用户最后一条消息的轮次 | positions = [len(c.messages) for c in convs] | 大部分用户在第几轮离开？ | 高 |
| 断点前情绪 | 最后一轮的情绪分数 | last_emotion = sentiment(last_message) | 是带着负面情绪离开的吗？ | 高 |
| 断点前 AI 行为 | 最后一轮 AI 的回应类型 | last_ai_msg = messages[-2] if messages[-1].role==user else messages[-1] | 最后一轮 AI 说了什么导致离开？ | 高 |
| 沉默时长 | 用户最后一次回复到现在的时长 | silence = now - last_message.time | 是暂时离开还是永久流失？ | 中 |
| 断点聚类 | 统计所有断点位置的分布 | from collections import Counter
Counter(positions) | 找到死亡轮次（如第 3 轮） | 高 |

## Sheet 5: 对话质量指标

| 指标名称 | 计算方法 | Python 代码示例 | 业务洞察 | 优先级 |
| --- | --- | --- | --- | --- |
| 话题切换频率 | 话题变化的次数 / 总轮次 | switches = sum(1 for i if topic[i]!=topic[i-1])
rate = switches/len | 切换太快 = 没深度，太慢 = 无聊 | 中 |
| 用户主动提问比例 | 用户提问次数 / 用户消息总数 | questions = sum(1 for m in user_msgs if ? in m)
rate = questions/len | 用户好奇 = 投入度高 | 中 |
| AI 主导 vs 用户主导 | AI 发起话题数 / 用户发起话题数 | ai_topics = sum(1 for t if t.initiator==ai)
ratio = ai_topics:user_topics | 1:1 最理想，AI 太多 = 说教 | 中 |
| 用户输入长度趋势 | 每轮用户消息字数的变化 | lengths = [len(m.content) for m in user_msgs]
trend = slope(lengths) | 越来越短 = 失去兴趣 | 高 |
| AI 回应长度 | AI 消息平均字数 | avg_len = mean([len(m.content) for m in ai_msgs]) | 太长 = 压迫感，太短 = 敷衍 | 中 |
| 共情语句密度 | 包含共情词的回应比例 | empathy_words = [我理解，我明白，我懂]
rate = count(empathy_words)/len | 共情能力够不够 | 高 |

## Sheet 6: 用户参与度指标

| 指标名称 | 计算方法 | Python 代码示例 | 业务洞察 | 优先级 |
| --- | --- | --- | --- | --- |
| 个人信息分享度 | 用户分享个人信息的轮次占比 | personal = count(name,age,work...)
rate = personal/len | 愿意分享 = 信任建立 | 高 |
| 表情 emoji 使用率 | 包含表情的消息比例 | emoji_msgs = count(emoji)
rate = emoji_msgs/len | 情绪投入度 | 中 |
| 用户重复问题次数 | 相同/类似问题出现的次数 | from collections import Counter
repeats = Counter(questions) | AI 没听懂？用户不耐烦？ | 中 |
| 用户困惑表达 | 什么意思、不懂等词频 | confused_words = [什么，不懂，不明白]
count = sum(confused_words) | AI 表达不清晰 | 中 |
| 24 小时返回率 | 24 小时内再次对话的比例 | return_users = count(user if user.last_visit < 24h)
rate = return_users/total | 真正的留存指标 | 高 |

## Sheet 7: 问题诊断指标

| 指标名称 | 计算方法 | Python 代码示例 | 业务洞察 | 优先级 |
| --- | --- | --- | --- | --- |
| 说教检测 | AI 消息包含应该、必须等词的频率 | preachy = [应该，必须，你要]
count = sum(p in msg for p in preachy) | 说教太多 = 用户反感 | 高 |
| 无视检测 | 用户提问后 AI 转移话题的比例 | if user.asked and not ai.answered:
  ignored += 1 | AI 没理解用户？ | 高 |
| 重复检测 | AI 重复相同回应的次数 | from collections import Counter
repeats = Counter(ai_responses) | 模型多样性不够 | 中 |
| 最佳实践对话 | 高留存对话的共同特征 | high_retention = filter(convs, retention>0.7)
common_patterns = extract(high_retention) | 复制成功模式 | 高 |
| 负面模式识别 | 低留存对话的共同特征 | low_retention = filter(convs, retention<0.3)
common_issues = extract(low_retention) | 避免失败模式 | 高 |

## Sheet 8: 可视化建议

| 指标类别 | 推荐图表 | 实现方式 | 业务场景 |
| --- | --- | --- | --- |
| 情绪曲线 | 折线图 | Chart.js Line Chart | 一眼看出用户心情变化趋势 |
| 断点热力图 | 热力图 | Chart.js Heatmap | 一眼看出用户在哪流失 |
| 对话深度漏斗 | 漏斗图 | Chart.js Funnel | 一眼看出留存情况 |
| 说教检测雷达图 | 雷达图 | Chart.js Radar | 一眼看出 AI 问题 |
| 情绪波动 | 箱线图 | Chart.js Box Plot | 情绪稳定性分析 |
| 活跃时段 | 热力图 | Chart.js Calendar Heatmap | 用户活跃时间分布 |
| 话题切换 | 桑基图 | D3.js Sankey | 话题流转路径 |
| 用户参与度 | 散点图 | Chart.js Scatter | 参与度与留存关系 |
