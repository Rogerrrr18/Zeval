from __future__ import annotations

import json
import os
import re
import sys
from functools import lru_cache
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.pilot_runner import FrontierTestAgent, PilotExperimentRunner, default_agent, eval_turn_to_dict, summarize_results
from src.report_html import write_html_report
from src.run_experiment import load_dataset
from src.session_asset_extractor import SessionAssetExtractor

ROOT = Path(__file__).resolve().parent.parent
DEMO_DIR = ROOT / "demo"
DEMO_RUN_DIR = ROOT / "results" / "demo_runs"
DEMO_RUN_DIR.mkdir(parents=True, exist_ok=True)


def _load_local_env(env_path: Path):
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_local_env(ROOT / ".env")


class DemoAgents:
    @staticmethod
    def weak_echo(user_text: str, system_prefix: str = "", context: str = "") -> str:
        return default_agent(user_text, system_prefix, context)

    @staticmethod
    def scripted_context(user_text: str, system_prefix: str = "", context: str = "") -> str:
        raw_fact = system_prefix.replace("【会话已知事实】", "").replace("请在不重复调用外部系统的前提下，优先基于该事实作答。", "").strip()
        fact = raw_fact.split("：", 1)[-1].strip() if raw_fact else ""
        text = user_text.lower()
        if any(x in text for x in ["thank you", "goodbye", "谢谢", "再见", "that will be all"]):
            return "好的，这边就先处理到这里。祝你顺利，如果还需要我可以继续帮你。"
        if fact:
            return f"我直接基于已有结果处理：{fact}"
        if any(x in text for x in ["book", "预订", "订", "reservation"]):
            return "我理解你要继续完成预订，但目前缺少可直接确认的订单结果；如果要严谨完成，我还需要房型、日期、人数中的缺失信息。"
        return "我理解了你的需求，但现在还缺少足够的已知结果支撑直接完成，所以我先说明缺口，而不是只复述你的原话。"


标签中文 = {
    "weak_echo": "弱基线（只会复述）",
    "scripted_context": "中等基线（会利用已知事实）",
    "llm": "真实模型",
}


@lru_cache(maxsize=8)
def cached_sessions(dataset: str, data_dir: str, max_sessions: int):
    raw = load_dataset(dataset, data_dir, max_sessions * 3)
    unique = []
    seen = set()
    for item in raw:
        sid = item.get("id")
        if sid in seen:
            continue
        seen.add(sid)
        unique.append(item)
        if len(unique) >= max_sessions:
            break
    return unique


def _safe_name(text: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", text).strip("_") or "run"


def _build_agent_runner(spec: dict):
    kind = spec.get("kind", "weak_echo")
    if kind == "weak_echo":
        return DemoAgents.weak_echo
    if kind == "scripted_context":
        return DemoAgents.scripted_context
    if kind == "llm":
        model = spec.get("model") or os.environ.get("ZEVAL_TEST_AGENT_MODEL") or os.environ.get("ZEVAL_AGENT_MODEL")
        if not model:
            raise RuntimeError("你选择了真实模型，但当前没有提供模型名。请在界面里填写模型名，例如 gpt-5.5。")
        agent = FrontierTestAgent(model=model, strict=True)
        return agent.reply
    raise RuntimeError(f"未知 agent 类型：{kind}")


def _agent_display_name(spec: dict) -> str:
    kind = spec.get("kind", "weak_echo")
    if kind == "llm":
        model = spec.get("model") or "未命名模型"
        return f"真实模型｜{model}"
    return 标签中文.get(kind, kind)


def _normalize_compare_agents(data: dict) -> list[dict]:
    compare_agents = data.get("compare_agents")
    if isinstance(compare_agents, list) and compare_agents:
        result = []
        for item in compare_agents:
            if not isinstance(item, dict):
                continue
            kind = item.get("kind", "weak_echo")
            result.append({
                "kind": kind,
                "model": item.get("model", ""),
                "display_name": item.get("display_name") or _agent_display_name(item),
            })
        if result:
            return result

    # 兼容旧接口
    agent_mode = data.get("agent_mode", "weak_echo")
    if agent_mode == "llm_agent":
        return [{"kind": "llm", "model": data.get("model_name", ""), "display_name": _agent_display_name({"kind": "llm", "model": data.get("model_name", "")})}]
    return [{"kind": agent_mode, "model": data.get("model_name", ""), "display_name": 标签中文.get(agent_mode, agent_mode)}]


def get_demo_payload(
    session_id: str | None = None,
    dataset: str = "multiwoz",
    data_dir: str = ".",
    max_sessions: int = 20,
    alpha: float = 1.5,
    b_min: int = 2,
    global_cap: int = 12,
    challenge_mode: str = "normal",
    compare_agents: list[dict] | None = None,
) -> dict:
    sessions = cached_sessions(dataset, data_dir, max_sessions)
    if not sessions:
        raise RuntimeError("未找到可用 session 数据。")
    session = None
    if session_id:
        session = next((x for x in sessions if x.get("id") == session_id), None)
    if session is None:
        session = sessions[0]

    extractor = SessionAssetExtractor()
    asset = extractor.extract(session)
    validation_errors = extractor.validate_asset(asset)

    baseline_runner = PilotExperimentRunner(agent_fn=DemoAgents.weak_echo, alpha=alpha, b_min=b_min, global_cap=global_cap, challenge_mode=challenge_mode)
    baseline_metrics, baseline_rows = baseline_runner.run_baseline(asset, session)
    baseline_trace = [eval_turn_to_dict(x) for x in baseline_rows]

    runs = []
    for spec in compare_agents or [{"kind": "weak_echo", "display_name": 标签中文["weak_echo"]}]:
        agent_fn = _build_agent_runner(spec)
        runner = PilotExperimentRunner(agent_fn=agent_fn, alpha=alpha, b_min=b_min, global_cap=global_cap, challenge_mode=challenge_mode)
        dynamic_metrics, dynamic_rows = runner.run_dynamic(asset)
        summary = summarize_results([baseline_metrics], [dynamic_metrics])
        summary_payload = {
            "dataset": dataset,
            "sessions": 1,
            "baseline_metrics": [baseline_metrics.to_dict()],
            "dynamic_metrics": [dynamic_metrics.to_dict()],
            "summary": summary,
            "validation_errors": validation_errors,
        }
        safe = _safe_name(f"{session['id']}_{spec.get('display_name')}")
        html_path = DEMO_RUN_DIR / f"demo_{safe}.html"
        run_log_rows = baseline_trace + [eval_turn_to_dict(x) for x in dynamic_rows]
        write_html_report(html_path, dataset=dataset, summary_payload=summary_payload, run_log_rows=run_log_rows)
        runs.append({
            "agent_spec": spec,
            "display_name": spec.get("display_name") or _agent_display_name(spec),
            "dynamic_metrics": dynamic_metrics.to_dict(),
            "summary": summary,
            "dynamic_trace": [eval_turn_to_dict(x) for x in dynamic_rows],
            "html_report_path": str(html_path),
            "模型说明": spec.get("model") or 标签中文.get(spec.get("kind", ""), spec.get("kind", "")),
            "诊断": _diagnose_run(dynamic_metrics.to_dict(), [eval_turn_to_dict(x) for x in dynamic_rows]),
        })

    best_run = max(runs, key=lambda x: x["dynamic_metrics"]["composite_score"]) if runs else None
    compare_diagnosis = []
    for run in runs:
        metrics = run["dynamic_metrics"]
        gap_vs_best = None
        if best_run is not None:
            gap_vs_best = round(best_run["dynamic_metrics"]["composite_score"] - metrics["composite_score"], 4)
        compare_diagnosis.append({
            "display_name": run["display_name"],
            "综合分差距_vs_best": gap_vs_best,
            "优势": _collect_strengths(metrics),
            "短板": _collect_weaknesses(metrics),
            "主要失败类型": run["诊断"].get("top_fail_categories", []),
        })

    return {
        "session_id": session["id"],
        "asset": asset.to_dict(),
        "baseline_metrics": baseline_metrics.to_dict(),
        "baseline_trace": baseline_trace,
        "runs": runs,
        "validation_errors": validation_errors,
        "available_sessions": [x.get("id") for x in sessions],
        "challenge_mode": challenge_mode,
        "compare_diagnosis": compare_diagnosis,
        "judge_model": os.environ.get("ZEVAL_JUDGE_MODEL") or "heuristic",
        "judge_mode_cn": "真实评审模型" if os.environ.get("ZEVAL_JUDGE_MODEL") else "启发式评审",
        "api_base_url": os.environ.get("ZEVAL_JUDGE_BASE_URL") or os.environ.get("OPENAI_BASE_URL") or "未配置",
    }


def _diagnose_run(metrics: dict, rows: list[dict]) -> dict:
    fail_counter = {}
    bad_turns = []
    for row in rows:
        key = row.get("fail_category") or "无"
        fail_counter[key] = fail_counter.get(key, 0) + 1
        if row.get("judge_label") != "SATISFIED":
            bad_turns.append({
                "intent_index": row.get("intent_index"),
                "judge_label": row.get("judge_label"),
                "fail_category": key,
                "rationale": row.get("rationale"),
            })
    top_fail_categories = sorted(fail_counter.items(), key=lambda x: (-x[1], x[0]))[:3]
    return {
        "top_fail_categories": [{"类型": k, "次数": v} for k, v in top_fail_categories if k != "无"],
        "bad_turns": bad_turns[:5],
        "strengths": _collect_strengths(metrics),
        "weaknesses": _collect_weaknesses(metrics),
    }


def _collect_strengths(metrics: dict) -> list[str]:
    strengths = []
    if metrics.get("intent_completion_rate", 0) >= 0.8:
        strengths.append("意图完成率高")
    if metrics.get("result_delivery_rate", 0) >= 0.7:
        strengths.append("结果交付能力强")
    if metrics.get("direct_answer_rate", 0) >= 0.7:
        strengths.append("直接回答比例高")
    if metrics.get("prompt_leak_rate", 1) <= 0.05:
        strengths.append("几乎没有提示泄漏")
    if metrics.get("parrot_rate", 1) <= 0.1:
        strengths.append("很少机械复述用户")
    return strengths or ["暂无明显优势"]


def _collect_weaknesses(metrics: dict) -> list[str]:
    weaknesses = []
    if metrics.get("intent_completion_rate", 1) < 0.6:
        weaknesses.append("意图完成率偏低")
    if metrics.get("result_delivery_rate", 1) < 0.5:
        weaknesses.append("经常没有真正交付结果")
    if metrics.get("direct_answer_rate", 1) < 0.5:
        weaknesses.append("容易绕开正面回答")
    if metrics.get("prompt_leak_rate", 0) > 0.1:
        weaknesses.append("存在提示泄漏风险")
    if metrics.get("parrot_rate", 0) > 0.2:
        weaknesses.append("复述用户过多")
    if metrics.get("deviation_rate", 0) > 0.2:
        weaknesses.append("偏航率偏高")
    return weaknesses or ["暂无明显短板"]


class DemoHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ["/", "/index.html"]:
            return self._serve_file(DEMO_DIR / "index.html", "text/html; charset=utf-8")
        if parsed.path == "/app.js":
            return self._serve_file(DEMO_DIR / "app.js", "application/javascript; charset=utf-8")
        if parsed.path == "/styles.css":
            return self._serve_file(DEMO_DIR / "styles.css", "text/css; charset=utf-8")
        if parsed.path == "/api/sessions":
            qs = parse_qs(parsed.query)
            dataset = qs.get("dataset", ["multiwoz"])[0]
            max_sessions = int(qs.get("max_sessions", ["20"])[0])
            sessions = cached_sessions(dataset, ".", max_sessions)
            return self._json({"sessions": [x.get("id") for x in sessions]})
        self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/run-demo":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            data = json.loads(body or "{}")
            payload = get_demo_payload(
                session_id=data.get("session_id"),
                dataset=data.get("dataset", "multiwoz"),
                data_dir=data.get("data_dir", "."),
                max_sessions=int(data.get("max_sessions", 20)),
                alpha=float(data.get("alpha", 1.5)),
                b_min=int(data.get("b_min", 2)),
                global_cap=int(data.get("global_cap", 12)),
                challenge_mode=data.get("challenge_mode", "normal"),
                compare_agents=_normalize_compare_agents(data),
            )
            return self._json(payload)
        except Exception as exc:
            return self._json({"error": str(exc)}, status=500)

    def log_message(self, format, *args):
        return

    def _serve_file(self, path: Path, content_type: str):
        if not path.exists():
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return
        content = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def _json(self, data: dict, status: int = 200):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


def main(host: str = "127.0.0.1", port: int = 8765):
    server = ThreadingHTTPServer((host, port), DemoHandler)
    print(f"Demo server running at http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
