# HR Resume Screening Benchmark

This is the first Benchmark Mode demo task. It mirrors AlphaEval-style
production task packages while staying small enough for local iteration.

## Goal

Given a job description and one candidate resume, the Agent must decide whether
to `select` or `reject` the candidate and explain the decision with evidence
from the resume and job description.

## Files

- `task.yaml` - task metadata and expected output contract.
- `query.md` - prompt template sent to each Agent framework.
- `rubrics/hr-screening-rubric.json` - approved rubric modules.
- `data/sample-cases.jsonl` - benchmark cases (mix of real and synthetic data).

## Data Sources

### Real Data (JobResQA)

**20 cases** derived from [JobResQA](https://github.com/Avature/jobresqa-benchmark)
— a real-world multilingual résumé–JD benchmark by Avature and Universitat
Politècnica de Catalunya (arXiv:2601.23183).

- 105 unique résumé–JD pairs from English-language subset
- QA pairs analyzed to derive `select`/`reject` decisions
- 10 select cases (strong qualification match) + 10 reject cases (clear mismatch)
- All PII anonymized with placeholders (`[NAME]`, `[COMPANY]`, etc.)

### Synthetic Fixtures

**9 cases** hand-crafted for specific skill-mismatch scenarios:
- Platform mismatch (Android → iOS)
- Discipline mismatch (Graphic Design → UX)
- Seniority mismatch (Junior → Senior)
- Direct skill matches

Total: **29 cases** (19 select + 10 reject)

## Attribution

JobResQA dataset: Carrino et al., "JobResQA: A Benchmark for LLM Machine
Reading Comprehension on Multilingual Résumés and JDs", arXiv:2601.23183,
Creative Commons BY-SA 2.0.

