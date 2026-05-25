const statusEl = document.getElementById('status');
const sessionSelect = document.getElementById('sessionSelect');
const runBtn = document.getElementById('runBtn');
const playBtn = document.getElementById('playBtn');
const summaryPanel = document.getElementById('summaryPanel');
const assetPanel = document.getElementById('assetPanel');
const diagnosisPanel = document.getElementById('diagnosisPanel');
const tracePanel = document.getElementById('tracePanel');

let latestResult = null;
let playIndex = 0;

const 标签中文 = {
  SATISFIED: '已满足',
  NOT_SATISFIED: '未满足',
  DEVIATION: '偏航',
};

const 困难模式中文 = {
  normal: '正常模式',
  missing_info: '缺信息施压',
  intent_shift: '中途改意图',
  constraint_conflict: '冲突约束',
  strict_recovery: '严格补救',
};

function badge(label) {
  const cls = label === 'SATISFIED' ? 'ok' : label === 'NOT_SATISFIED' ? 'mid' : 'bad';
  return `<span class="badge ${cls}">${标签中文[label] || label}</span>`;
}

function esc(text) {
  return String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function loadSessions() {
  statusEl.textContent = '正在加载会话列表…';
  const res = await fetch('/api/sessions');
  const data = await res.json();
  sessionSelect.innerHTML = data.sessions.map(x => `<option value="${x}">${x}</option>`).join('');
  statusEl.textContent = `已加载 ${data.sessions.length} 个会话样本，可以开始运行。`;
}

function summaryCard(title, value) {
  return `<div class="card"><div class="k">${title}</div><div class="v">${value}</div></div>`;
}

function collectCompareAgents() {
  const agents = [];
  if (document.getElementById('agentWeak').checked) {
    agents.push({ kind: 'weak_echo', display_name: '弱基线（只会复述）' });
  }
  if (document.getElementById('agentScripted').checked) {
    agents.push({ kind: 'scripted_context', display_name: '中等基线（会利用已知事实）' });
  }
  const models = document.getElementById('realModels').value
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean);
  models.forEach(model => {
    agents.push({ kind: 'llm', model, display_name: `真实模型｜${model}` });
  });
  return agents;
}

function renderSummary(result) {
  const best = [...result.runs].sort((a, b) => b.dynamic_metrics.composite_score - a.dynamic_metrics.composite_score)[0];
  summaryPanel.innerHTML = `
    <h2>总体结果</h2>
    <div class="cards">
      ${summaryCard('原始基线综合分', result.baseline_metrics.composite_score)}
      ${summaryCard('原始基线意图完成率', result.baseline_metrics.intent_completion_rate)}
      ${summaryCard('对比模型数', result.runs.length)}
      ${summaryCard('当前评审模式', result.judge_mode_cn)}
      ${summaryCard('困难模式', 困难模式中文[result.challenge_mode] || result.challenge_mode)}
      ${summaryCard('最佳动态综合分', best ? best.dynamic_metrics.composite_score : '-')}
      ${summaryCard('最佳对象', best ? best.display_name : '-')}
    </div>
    <p class="muted">为什么你之前看到“评审提示词 / 评审原始输出”是空白：因为当时走的是启发式评审，代码没有把启发式规则显式写回日志。现在我已经补上了，即使不是 LLM Judge，也会显示“启发式评审说明”和结构化原始输出。</p>
      <p class="muted">评审模型：${result.judge_model}｜接口地址：${result.api_base_url}</p>

    <h3>多模型对比表</h3>
    <table class="compare-table">
      <thead>
        <tr>
          <th>对比对象</th>
          <th>动态综合分</th>
          <th>动态意图完成率</th>
          <th>直接回答率</th>
          <th>结果交付率</th>
          <th>动态偏航率</th>
          <th>提示泄漏率</th>
          <th>复述用户率</th>
          <th>平均追问次数/意图</th>
          <th>报告文件</th>
        </tr>
      </thead>
      <tbody>
        ${result.runs.map(run => `
          <tr>
            <td>${esc(run.display_name)}</td>
            <td>${run.dynamic_metrics.composite_score}</td>
            <td>${run.dynamic_metrics.intent_completion_rate}</td>
            <td>${run.dynamic_metrics.direct_answer_rate}</td>
            <td>${run.dynamic_metrics.result_delivery_rate}</td>
            <td>${run.dynamic_metrics.deviation_rate}</td>
            <td>${run.dynamic_metrics.prompt_leak_rate}</td>
            <td>${run.dynamic_metrics.parrot_rate}</td>
            <td>${run.dynamic_metrics.followup_per_intent}</td>
            <td class="nowrap">${esc(run.html_report_path)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  summaryPanel.classList.remove('hidden');
}

function renderDiagnosis(result) {
  diagnosisPanel.innerHTML = `
    <h2>差异诊断</h2>
    <div class="diag-grid">
      ${result.compare_diagnosis.map(item => `
        <div class="diag-card">
          <h3>${esc(item.display_name)}</h3>
          <div class="muted">与最佳综合分差距：${esc(String(item['综合分差距_vs_best']))}</div>
          <div class="diag-section"><strong>优势</strong><ul>${(item.优势 || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div class="diag-section"><strong>短板</strong><ul>${(item.短板 || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div class="diag-section"><strong>主要失败类型</strong><ul>${(item.主要失败类型 || []).map(x => `<li>${esc(x.类型)} × ${esc(String(x.次数))}</li>`).join('') || '<li>无明显失败类型</li>'}</ul></div>
        </div>
      `).join('')}
    </div>
  `;
  diagnosisPanel.classList.remove('hidden');
}

function renderAsset(result) {
  const intents = result.asset.intent_sequence || [];
  assetPanel.innerHTML = `
    <h2>锁版资产（意图序列）</h2>
    <table>
      <thead><tr><th>意图编号</th><th>意图内容</th><th>成功标准</th><th>历史用户轮数</th></tr></thead>
      <tbody>
        ${intents.map(i => `<tr><td>${i.intent_index}</td><td>${esc(i.intent_text)}</td><td>${esc(i.success_criteria)}</td><td>${i.turn_span_user_turns}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
  assetPanel.classList.remove('hidden');
}

function renderTraceCard(row, index, hide = false) {
  return `
    <div class="trace-card" data-step="${index}" style="display:${hide ? 'none' : 'block'}">
      <div class="trace-head">
        <div>
          <strong>意图 ${row.intent_index} · 第 ${row.cycle_index} 轮</strong>
          <div class="muted">模拟用户策略：${esc(row.sim_strategy)}｜预算消耗 ${row.budget_used}/${row.budget}</div>
        </div>
        <div>${badge(row.judge_label)}</div>
      </div>
      <div class="trace-body">
        <div class="subgrid">
          <div>
            <div class="pill">模拟用户</div>
            <div class="quote">${esc(row.sim_note)}</div>
            <pre>${esc(row.user_text || '')}</pre>
          </div>
          <div>
            <div class="pill">评审器</div>
            <div class="quote">${esc(row.rationale || '')}</div>
            <div class="quote">证据引用：${esc(row.evidence_quote || '')}</div>
            <div class="quote">失败类型：${esc(row.fail_category || '无')}｜本轮得分：${esc(String(row.turn_score ?? ''))}</div>
          </div>
        </div>
        <div>
          <div class="pill">系统注入</div>
          <pre>${esc(row.system_prefix || '')}</pre>
        </div>
        <div>
          <div class="pill">助手回复</div>
          <pre>${esc(row.assistant_text || '')}</pre>
        </div>
        <div>
          <div class="pill">评审提示词</div>
          <pre>${esc(row.judge_prompt || '')}</pre>
        </div>
        <div>
          <div class="pill">评审原始输出</div>
          <pre>${esc(row.judge_raw_response || '')}</pre>
        </div>
      </div>
    </div>
  `;
}

function renderTrace(result) {
  const baselineHtml = result.baseline_trace.map((row, idx) => renderTraceCard(row, idx, false)).join('');
  const dynamicColumns = result.runs.map((run, colIdx) => {
    const cards = run.dynamic_trace.map((row, idx) => renderTraceCard(row, idx, colIdx === 0 ? idx > 0 : false)).join('');
    return `
      <div class="trace-col">
        <h3 class="trace-title">${esc(run.display_name)}</h3>
        <p class="trace-sub">动态综合分 ${run.dynamic_metrics.composite_score}｜意图完成率 ${run.dynamic_metrics.intent_completion_rate}</p>
        <p class="trace-sub">报告：${esc(run.html_report_path)}</p>
        <div class="dynamic-wrap" data-col="${colIdx}">${cards}</div>
      </div>
    `;
  }).join('');

  tracePanel.innerHTML = `
    <h2>过程可视化</h2>
    <div class="columns">
      <div class="trace-col">
        <h3 class="trace-title">原始基线判断</h3>
        <p class="trace-sub">这是把历史原始会话按意图切片后合并得到的基线判断。</p>
        ${baselineHtml}
      </div>
      ${dynamicColumns}
    </div>
  `;
  tracePanel.classList.remove('hidden');
}

function resetPlayback() {
  playIndex = 0;
  const firstColCards = tracePanel.querySelectorAll('.dynamic-wrap[data-col="0"] .trace-card');
  firstColCards.forEach((card, idx) => {
    card.style.display = idx === 0 ? 'block' : 'none';
  });
  playBtn.disabled = !firstColCards.length;
}

function playNext() {
  const cards = [...tracePanel.querySelectorAll('.dynamic-wrap[data-col="0"] .trace-card')];
  if (!cards.length) return;
  if (playIndex < cards.length - 1) {
    playIndex += 1;
    cards[playIndex].style.display = 'block';
    statusEl.textContent = `已展开最左侧动态回放：第 ${playIndex + 1}/${cards.length} 轮。`;
  } else {
    statusEl.textContent = '最左侧动态回放已全部展开。';
  }
}

async function runDemo() {
  const compareAgents = collectCompareAgents();
  if (!compareAgents.length) {
    statusEl.textContent = '请至少选择一个对比对象。';
    return;
  }
  runBtn.disabled = true;
  playBtn.disabled = true;
  statusEl.textContent = '正在运行多模型对比，请稍等…';
  const payload = {
    session_id: sessionSelect.value,
    alpha: Number(document.getElementById('alpha').value),
    b_min: Number(document.getElementById('bMin').value),
    global_cap: Number(document.getElementById('globalCap').value),
    challenge_mode: document.getElementById('challengeMode').value,
    max_sessions: 20,
    compare_agents: compareAgents,
  };
  const res = await fetch('/api/run-demo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    statusEl.textContent = `运行失败：${data.error || '未知错误'}`;
    runBtn.disabled = false;
    return;
  }
  latestResult = data;
  renderSummary(data);
  renderAsset(data);
  renderDiagnosis(data);
  renderTrace(data);
  resetPlayback();
  playBtn.disabled = false;
  runBtn.disabled = false;
  statusEl.textContent = `运行完成：${data.session_id}｜共比较 ${data.runs.length} 个对象。`;
}

runBtn.addEventListener('click', runDemo);
playBtn.addEventListener('click', playNext);
loadSessions().catch(err => {
  statusEl.textContent = `加载失败：${err.message}`;
});
