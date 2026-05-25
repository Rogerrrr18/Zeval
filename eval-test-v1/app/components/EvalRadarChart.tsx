"use client";

/** 雷达四维（0–1 归一展示）。 */
export type RadarVec = {
  intent_completion_rate: number;
  followup_quality: number;
  inverse_deviation: number;
  turn_quality: number;
};

type Props = { B: RadarVec; D: RadarVec };

/**
 * 四维雷达图：基线 B 与动态臂 D。
 */
export function EvalRadarChart({ B, D }: Props) {
  const keys: (keyof RadarVec)[] = [
    "intent_completion_rate",
    "followup_quality",
    "inverse_deviation",
    "turn_quality",
  ];
  const labels = ["意图完成", "追问质量", "抗偏离", "轮次效率"];
  const cx = 120;
  const cy = 120;
  const r = 90;
  const n = keys.length;
  const pts = (vec: RadarVec) =>
    keys.map((k, i) => {
      const v = Math.max(0, Math.min(1, vec[k]));
      const ang = (-Math.PI / 2 + (2 * Math.PI * i) / n) as number;
      return `${cx + r * v * Math.cos(ang)},${cy + r * v * Math.sin(ang)}`;
    });
  const polyB = pts(B).join(" ");
  const polyD = pts(D).join(" ");
  const axis = keys.map((_, i) => {
    const ang = (-Math.PI / 2 + (2 * Math.PI * i) / n) as number;
    const x2 = cx + r * Math.cos(ang);
    const y2 = cy + r * Math.sin(ang);
    const lx = cx + (r + 18) * Math.cos(ang);
    const ly = cy + (r + 18) * Math.sin(ang);
    return (
      <g key={i}>
        <line x1={cx} y1={cy} x2={x2} y2={y2} stroke="#334155" strokeWidth={1} />
        <text x={lx} y={ly} fill="#94a3b8" fontSize={10} textAnchor="middle" dominantBaseline="middle">
          {labels[i]}
        </text>
      </g>
    );
  });
  return (
    <svg width={280} height={260} viewBox="0 0 240 240" aria-label="B 与 D 雷达对比">
      {axis}
      <polygon points={polyB} fill="none" stroke="#38bdf8" strokeWidth={2} />
      <polygon points={polyD} fill="rgba(234,179,8,0.15)" stroke="#eab308" strokeWidth={2} />
      <text x={8} y={16} fill="#38bdf8" fontSize={10}>
        B 原始
      </text>
      <text x={8} y={30} fill="#eab308" fontSize={10}>
        D 动态
      </text>
    </svg>
  );
}
