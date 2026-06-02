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
- `data/sample-cases.jsonl` - small fixture cases for smoke testing.

## Next Step

For the full experiment, generate more cases from:

https://huggingface.co/datasets/AzharAli05/Resume-Screening-Dataset

