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
- `data/sample-cases.jsonl` - benchmark cases derived from JobResQA real-world resume/JD pairs.

## Data Sources

### Real Data (JobResQA)

**16 cases** derived from [JobResQA](https://github.com/Avature/jobresqa-benchmark)
— a real-world multilingual résumé–JD benchmark by Avature and Universitat
Politècnica de Catalunya (arXiv:2601.23183).

- 105 unique résumé–JD pairs from English-language subset
- QA pairs analyzed to derive `select`/`reject` decisions
- Select cases (strong qualification match) + reject cases (clear mismatch)
- All PII anonymized with placeholders (`[NAME]`, `[COMPANY]`, etc.)
- Mock, fixture, and synthetic cases have been removed so benchmark runs only use real sourced cases.

## Attribution

JobResQA dataset: Carrino et al., "JobResQA: A Benchmark for LLM Machine
Reading Comprehension on Multilingual Résumés and JDs", arXiv:2601.23183,
Creative Commons BY-SA 2.0.
