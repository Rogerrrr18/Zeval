"use client";

import styles from "@/app/experiment.module.css";

type Props = {
  selectedId: string | null;
  sessionCount: number;
  intentRowCount: number;
  /** 已成功写入或读取服务端绑定抽取结果（用于持久化复现）。 */
  serverLockReady: boolean;
  hasEvalPanel: boolean;
};

/**
 * 实验主流程说明：操作顺序、作用域（仅当前 session）与下一步提示。
 */
export function WorkflowGuide(props: Props) {
  const { selectedId, sessionCount, intentRowCount, serverLockReady, hasEvalPanel } = props;

  let next = "";
  if (!selectedId) {
    next = "请先在「2. Session 选择」中选中一条对话。";
  } else if (intentRowCount === 0) {
    next = `已选「${selectedId}」。请点击「抽取/读取绑定结果」：若该 session 已抽取过，会直接复用绑定结果；否则只为这一条 session 调用模型。`;
  } else {
    next = `已选「${selectedId}」且表格有数据。校对意图/回填表后，可在下方选择自动或真人动态评测；人工修订后可点「保存绑定结果」。`;
  }

  return (
    <div className={styles.flowCard}>
      <h2 className={styles.flowTitle}>操作顺序与作用域</h2>
      <p className={styles.flowLead}>
        除「导入 CSV」会一次性载入<strong>全部</strong> session 外，下面所有按钮作用对象均为<strong>当前下拉框选中的那一条 session</strong>，不会自动对其它 session 跑抽取或评测。
      </p>
      <ol className={styles.flowList}>
        <li>
          <strong>0 · 实验设置</strong>：配置 API Key 并保存（若未配置，抽取/评测会失败）。
        </li>
        <li>
          <strong>1 · 导入 CSV</strong>：解析并保存所有 session 到后端；预览表可查看全量行。
        </li>
        <li>
          <strong>2 · 选择 session</strong>：在下拉框中选中要处理的一条；切换选项会清空下方抽取表（避免串会话）。
        </li>
        <li>
          <strong>3a · 抽取/读取绑定结果</strong>：首次对<strong>当前选中</strong> session 调用 LLM 并自动绑定；之后复用绑定 JSON，避免不可复现。
        </li>
        <li>
          <strong>3b · 读取绑定结果</strong>：从磁盘读回该 session 已绑定的意图序列与可回填项继续修改。
        </li>
        <li>
          <strong>3c · 保存绑定结果</strong>：人工修订表格后覆盖该 session 的绑定文件，后续评测与导出均以此为准。
        </li>
        <li>
          <strong>3d · 运行动态评测</strong>：在<strong>「动态评测对话（实时）」</strong>卡片内点击按钮；仅评测当前选中的 session（基线 B 用 CSV 原文，动态 D 用当前表格；对话在该卡片内按轮次展示）。
        </li>
        <li>
          <strong>4 · 看结果</strong>：雷达与日志出现在页面底部；若要跑下一条，回到步骤 2 换 session，从 3a 或 3b 继续。
        </li>
      </ol>
      <div className={styles.flowNext}>
        <strong>下一步建议</strong>
        <p>{next}</p>
        {serverLockReady ? (
          <p className={styles.flowNote}>当前 session 已绑定抽取结果，可随时读取恢复表格。</p>
        ) : null}
        {hasEvalPanel ? (
          <p className={styles.flowNote}>若你刚换了 session，下方「结果」区可能仍是上一次的评测输出，请以当前选中 session 为准重新评测。</p>
        ) : null}
      </div>
    </div>
  );
}
