from __future__ import annotations

import html
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path


事件中文 = {
    "baseline_intent_judged": "基线意图判定",
    "intent_satisfied": "本意图完成",
    "intent_failed_budget": "预算耗尽未完成",
    "continue": "继续追问",
}

来源中文 = {
    "heuristic": "启发式规则",
    "llm": "真实评审模型",
}


def _esc(text: str) -> str:
    return html.escape(text or "")


def _badge(label: str) -> str:
    label_cn = {
        "SATISFIED": "已满足",
        "NOT_SATISFIED": "未满足",
        "DEVIATION": "偏航",
    }.get(label, label)
    cls = {
        "SATISFIED": "ok",
        "NOT_SATISFIED": "mid",
        "DEVIATION": "bad",
    }.get(label, "mid")
    return f'<span class="badge {cls}">{_esc(label_cn)}</span>'


def write_html_report(
    out_path: Path,
    *,
    dataset: str,
    summary_payload: dict,
    run_log_rows: list[dict],
    generated_at: str | None = None,
):
    generated_at = generated_at or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    summary = summary_payload["summary"]
    baseline_metrics = summary_payload.get("baseline_metrics", [])
    dynamic_metrics = summary_payload.get("dynamic_metrics", [])

    session_metric_map: dict[str, dict] = {}
    for item in dynamic_metrics:
        session_metric_map[item["session_id"]] = {"dynamic": item}
    for item in baseline_metrics:
        session_metric_map.setdefault(item["session_id"], {})["baseline"] = item

    grouped: dict[str, dict[str, list[dict]]] = defaultdict(lambda: {"baseline": [], "dynamic": []})
    for row in run_log_rows:
        grouped[row["session_id"]][row.get("eval_mode", "dynamic")].append(row)

    session_blocks = []
    for session_id in sorted(grouped.keys()):
        base = grouped[session_id]["baseline"]
        dyn = grouped[session_id]["dynamic"]
        metrics = session_metric_map.get(session_id, {})
        session_blocks.append(
            f"""
            <section class=\"session\">
              <h3>{_esc(session_id)}</h3>
              <div class=\"session-meta\">原始基线综合分：<strong>{metrics.get('baseline', {}).get('composite_score', '-')}</strong> &nbsp;|&nbsp; 动态回放综合分：<strong>{metrics.get('dynamic', {}).get('composite_score', '-')}</strong></div>
              <div class=\"two-col\">
                <div>
                  <h4>原始基线判断</h4>
                  {_render_turns(base)}
                </div>
                <div>
                  <h4>动态回放判断</h4>
                  {_render_turns(dyn)}
                </div>
              </div>
            </section>
            """
        )

    html_text = f"""<!DOCTYPE html>
<html lang=\"zh-CN\">
<head>
  <meta charset=\"UTF-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
  <title>实验报告｜真实模型判断过程</title>
  <style>
    body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f6f8fb;color:#0f172a;margin:0}}
    .wrap{{max-width:1280px;margin:32px auto;padding:0 18px 48px}}
    .panel{{background:#fff;border:1px solid #e2e8f0;border-radius:18px;box-shadow:0 10px 30px rgba(15,23,42,.05);padding:28px}}
    h1{{font-size:32px;margin:0 0 8px}} h2{{font-size:24px;margin:32px 0 14px}} h3{{font-size:20px;margin:0 0 8px}} h4{{font-size:16px;margin:8px 0 12px}}
    p,li{{line-height:1.7}} code,pre{{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}}
    .meta{{background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;padding:14px 16px;border-radius:12px;font-size:14px}}
    .summary{{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:12px;margin:18px 0 8px}}
    .card{{background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:14px}}
    .k{{font-size:12px;color:#64748b;letter-spacing:.02em}} .v{{font-size:24px;font-weight:700;margin-top:6px}}
    .two-col{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}
    .session{{border-top:1px solid #e2e8f0;padding-top:22px;margin-top:22px}}
    .session-meta{{font-size:14px;color:#475569;margin-bottom:12px}}
    .turn{{border:1px solid #e2e8f0;border-radius:14px;background:#fff;margin:10px 0;overflow:hidden}}
    .turn summary{{cursor:pointer;list-style:none;padding:14px 16px;background:#f8fafc;display:flex;justify-content:space-between;gap:12px;align-items:center}}
    .turn summary::-webkit-details-marker{{display:none}}
    .turn-body{{padding:14px 16px 16px}}
    .badge{{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:700}}
    .badge.ok{{background:#dcfce7;color:#166534}} .badge.mid{{background:#fef3c7;color:#92400e}} .badge.bad{{background:#fee2e2;color:#991b1b}}
    .sub{{font-size:12px;color:#64748b}}
    .block{{margin:10px 0}}
    pre{{white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:10px;font-size:12px;overflow:auto}}
    .quote{{padding:10px 12px;border-left:3px solid #cbd5e1;background:#f8fafc;border-radius:8px}}
    @media (max-width: 1000px){{.summary,.two-col{{grid-template-columns:1fr}}}}
  </style>
</head>
<body>
  <div class=\"wrap\">
    <div class=\"panel\">
      <h1>真实模型判断过程报告</h1>
      <div class=\"meta\">数据集：<code>{_esc(dataset)}</code><br/>生成时间：<code>{_esc(generated_at)}</code><br/>说明：下面直接展开每个会话在原始基线 / 动态回放下的判断过程，包括意图、成功标准、用户输入、助手回复、判定标签、评审提示词、评审原始输出。</div>

      <h2>总体摘要</h2>
      <div class=\"summary\">
        {_summary_card('原始基线意图完成率', summary['baseline']['intent_completion_rate'])}
        {_summary_card('动态回放意图完成率', summary['dynamic']['intent_completion_rate'])}
        {_summary_card('动态直接回答率', summary['dynamic'].get('direct_answer_rate', '-'))}
        {_summary_card('动态结果交付率', summary['dynamic'].get('result_delivery_rate', '-'))}
        {_summary_card('动态提示泄漏率', summary['dynamic'].get('prompt_leak_rate', '-'))}
        {_summary_card('动态复述用户率', summary['dynamic'].get('parrot_rate', '-'))}
        {_summary_card('动态平均单轮得分', summary['dynamic'].get('avg_turn_score', '-'))}
        {_summary_card('原始基线综合分', summary['baseline']['composite_score'])}
        {_summary_card('动态回放综合分', summary['dynamic']['composite_score'])}
        {_summary_card('会话数', summary['sessions'])}
      </div>

      <h2>逐会话判断过程</h2>
      {''.join(session_blocks) if session_blocks else '<p>暂无运行日志。</p>'}
    </div>
  </div>
</body>
</html>"""
    out_path.write_text(html_text, encoding="utf-8")


def _summary_card(title: str, value) -> str:
    return f'<div class="card"><div class="k">{_esc(title)}</div><div class="v">{_esc(str(value))}</div></div>'


def _render_turns(rows: list[dict]) -> str:
    if not rows:
        return '<p class="sub">无数据</p>'
    parts = []
    for row in rows:
        title = f"意图 {row.get('intent_index')} · {事件中文.get(row.get('event', ''), row.get('event', ''))}"
        judge_model = row.get("judge_model") or row.get("judge_source") or "未知"
        if judge_model == "heuristic":
            judge_model = "启发式评审"
        judge_source = 来源中文.get(row.get("judge_source", ""), row.get("judge_source", ""))
        raw = row.get("judge_raw_response") or json.dumps({
            "标签": row.get("judge_label"),
            "理由": row.get("rationale"),
            "证据引用": row.get("evidence_quote"),
        }, ensure_ascii=False, indent=2)
        parts.append(
            f"""
            <details class=\"turn\">
              <summary>
                <div><strong>{_esc(title)}</strong><div class=\"sub\">评审模型={_esc(judge_model)}｜判定来源={_esc(judge_source)}</div></div>
                <div>{_badge(row.get('judge_label', ''))}</div>
              </summary>
              <div class=\"turn-body\">
                <div class=\"block\"><strong>意图</strong><div>{_esc(row.get('intent_text', ''))}</div></div>
                <div class=\"block\"><strong>成功标准</strong><div>{_esc(row.get('success_criteria', ''))}</div></div>
                <div class=\"block\"><strong>用户输入</strong><pre>{_esc(row.get('user_text', ''))}</pre></div>
                <div class=\"block\"><strong>模拟用户策略</strong><div class=\"quote\">{_esc(row.get('sim_strategy', ''))}｜预算 {row.get('budget_used', '-')}/{row.get('budget', '-')}</div></div>
                <div class=\"block\"><strong>模拟用户备注</strong><div class=\"quote\">{_esc(row.get('sim_note', ''))}</div></div>
                <div class=\"block\"><strong>系统注入</strong><pre>{_esc(row.get('system_prefix', ''))}</pre></div>
                <div class=\"block\"><strong>助手回复</strong><pre>{_esc(row.get('assistant_text', ''))}</pre></div>
                <div class=\"block\"><strong>评审结论</strong><div class=\"quote\">{_badge(row.get('judge_label', ''))} &nbsp; {_esc(row.get('rationale', ''))}</div></div>
                <div class=\"block\"><strong>证据引用</strong><div class=\"quote\">{_esc(row.get('evidence_quote', ''))}</div></div>
                <div class=\"block\"><strong>失败归因</strong><div class=\"quote\">{_esc(row.get('fail_category', '无'))}</div></div>
                <div class=\"block\"><strong>单轮信号</strong><div class=\"quote\">直接回答={_esc(str(row.get('directly_answered', False)))}｜给出结果={_esc(str(row.get('delivered_result', False)))}｜仍在追问={_esc(str(row.get('asked_followup', False)))}｜提示泄漏={_esc(str(row.get('leaked_prompt', False)))}｜复述用户={_esc(str(row.get('parroted_user', False)))}｜本轮得分={_esc(str(row.get('turn_score', 0)))}</div></div>
                <div class=\"block\"><strong>评审提示词</strong><pre>{_esc(row.get('judge_prompt', ''))}</pre></div>
                <div class=\"block\"><strong>评审原始输出</strong><pre>{_esc(raw)}</pre></div>
              </div>
            </details>
            """
        )
    return ''.join(parts)
