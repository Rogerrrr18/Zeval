"""
基于意图指针的动态评测效果实验方案（pilot）运行入口。

默认流程：
1. 从 CSV / JSON 载入 session
2. 每个 session 生成 draft + locked asset
3. 使用 locked asset 运行：
   - 原始 session 基线 B
   - 动态回放 D
4. 输出 metrics / run_log / radar

用法示例：
    python src/run_experiment.py --dataset multiwoz --data-dir . --sessions 10 --output-dir results/pilot
    python src/run_experiment.py --step extract --dataset multiwoz --data-dir .
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.session_asset_extractor import SessionAssetExtractor
from src.pilot_runner import PilotExperimentRunner, eval_turn_to_dict, generate_radar_svg, summarize_results, write_json, write_jsonl
from src.report_html import write_html_report


def load_multiwoz(data_dir: str, max_sessions: int | None = None) -> list[dict]:
    sessions = []
    data_path = Path(data_dir) / "data" / "multiwoz"

    for split in ["train", "dev", "test"]:
        json_files = list(data_path.glob(f"*{split}*.json")) + list(data_path.glob(f"*{split}*.jsonl"))
        for jf in json_files:
            with open(jf, encoding="utf-8") as f:
                data = json.load(f) if jf.suffix == ".json" else [json.loads(l) for l in f if l.strip()]
            if isinstance(data, list):
                for item in data:
                    sessions.append(_normalize_multiwoz(item))
            elif isinstance(data, dict):
                for k, v in data.items():
                    sessions.append(_normalize_multiwoz(v, sid=k))

    if not sessions:
        for cf in sorted(data_path.glob("*.csv")):
            sessions.extend(_load_turn_csv(cf))

    if max_sessions:
        sessions = sessions[:max_sessions]
    return sessions


def _normalize_multiwoz(item: dict, sid: str | None = None) -> dict:
    turns = []
    dialogue = item.get("turns", item.get("dialogue", []))
    for idx, t in enumerate(dialogue):
        if isinstance(t, dict):
            role = t.get("role", t.get("speaker", "user")).lower()
            if role == "system":
                role = "agent"
            text = t.get("text", t.get("utterance", ""))
            turns.append({"role": role, "text": text, "turn_num": int(t.get("turn_num", idx)), **t})
    return {"id": sid or item.get("dialogue_id", item.get("id", "unknown")), "turns": turns}


def _load_turn_csv(csv_path: Path) -> list[dict]:
    grouped = {}
    with open(csv_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            did = row.get("dialogue_id") or row.get("session_id") or "unknown"
            grouped.setdefault(did, {"id": did, "turns": [], "source_file": csv_path.name})
            speaker = (row.get("speaker") or row.get("role") or "USER").strip().lower()
            role = "user" if speaker == "user" else "agent"
            grouped[did]["turns"].append(
                {
                    "role": role,
                    "text": row.get("utterance") or row.get("content") or "",
                    "turn_num": int(row.get("turn_num") or row.get("turn_index") or len(grouped[did]["turns"])),
                    "speaker": row.get("speaker", row.get("role", "")),
                    "services": row.get("services", ""),
                    "active_intents": row.get("active_intents", ""),
                    "slot_values": row.get("slot_values", ""),
                    "timestamp": row.get("timestamp", ""),
                }
            )
    sessions = []
    for session in grouped.values():
        session["turns"].sort(key=lambda t: t.get("turn_num", 0))
        sessions.append(session)
    return sessions


def load_dataset(name: str, data_dir: str, max_sessions: int = 10) -> list[dict]:
    if name.lower() != "multiwoz":
        raise ValueError("Pilot 版本当前仅支持 multiwoz / turn-level CSV 输入")
    return load_multiwoz(data_dir, max_sessions)


def run_pilot(dataset: str, data_dir: str, sessions: int, output_dir: str, step: str = "all") -> dict:
    out_root = Path(output_dir)
    out_root.mkdir(parents=True, exist_ok=True)
    assets_dir = out_root / "assets"
    assets_dir.mkdir(exist_ok=True)

    session_data = load_dataset(dataset, data_dir, sessions)
    if not session_data:
        raise RuntimeError("No session data found. Please place CSV/JSON under data/multiwoz/")

    extractor = SessionAssetExtractor()
    runner = PilotExperimentRunner()

    draft_assets = []
    validation_errors = []
    baseline_metrics = []
    dynamic_metrics = []
    run_log_rows = []

    for session in session_data:
        asset = extractor.extract(session)
        errors = extractor.validate_asset(asset)
        draft_path = assets_dir / f"{asset.session_id}.draft.json"
        locked_path = assets_dir / f"{asset.session_id}_locked.json"
        extractor.ensure_locked_asset(asset, draft_path, locked_path)
        draft_assets.append({"session_id": asset.session_id, "draft": str(draft_path), "locked": str(locked_path), "errors": errors})
        if errors:
            validation_errors.append({"session_id": asset.session_id, "errors": errors})
        if step == "extract":
            continue

        locked_asset = extractor.load_asset(locked_path)
        baseline, baseline_rows = runner.run_baseline(locked_asset, session)
        dynamic, turn_rows = runner.run_dynamic(locked_asset)
        baseline_metrics.append(baseline)
        dynamic_metrics.append(dynamic)
        for row in baseline_rows:
            run_log_rows.append(eval_turn_to_dict(row))
        for row in turn_rows:
            run_log_rows.append(eval_turn_to_dict(row))

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    write_json(out_root / f"draft_assets_{timestamp}.json", {"assets": draft_assets, "validation_errors": validation_errors})

    if step == "extract":
        return {"status": "ok", "step": "extract", "assets": len(draft_assets), "validation_errors": validation_errors}

    summary = summarize_results(baseline_metrics, dynamic_metrics)
    summary_payload = {
        "schema_version": "2026-02-intent-refill-v1",
        "prompt_version": "pilot-v1",
        "dataset": dataset,
        "sessions": len(dynamic_metrics),
        "baseline_metrics": [m.to_dict() for m in baseline_metrics],
        "dynamic_metrics": [m.to_dict() for m in dynamic_metrics],
        "summary": summary,
        "validation_errors": validation_errors,
    }
    write_json(out_root / f"metrics_summary_{timestamp}.json", summary_payload)
    run_log_path = out_root / f"run_log_{timestamp}.jsonl"
    write_jsonl(run_log_path, run_log_rows)
    radar_path = out_root / f"radar_{timestamp}.svg"
    generate_radar_svg(summary, radar_path)
    html_report_path = out_root / f"report_{timestamp}.html"
    write_html_report(
        html_report_path,
        dataset=dataset,
        summary_payload=summary_payload,
        run_log_rows=run_log_rows,
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    )

    return {
        "status": "ok",
        "step": step,
        "sessions": len(dynamic_metrics),
        "summary": summary,
        "radar": str(radar_path),
        "run_log": str(run_log_path),
        "html_report": str(html_report_path),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Intent-pointer pilot experiment runner")
    parser.add_argument("--dataset", type=str, default="multiwoz")
    parser.add_argument("--data-dir", type=str, default=".")
    parser.add_argument("--sessions", type=int, default=10)
    parser.add_argument("--output-dir", type=str, default="./results/pilot")
    parser.add_argument("--step", type=str, choices=["extract", "all"], default="all")
    args = parser.parse_args()

    result = run_pilot(
        dataset=args.dataset,
        data_dir=args.data_dir,
        sessions=args.sessions,
        output_dir=args.output_dir,
        step=args.step,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
