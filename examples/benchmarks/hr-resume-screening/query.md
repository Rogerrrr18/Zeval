You are screening one candidate for a business hiring workflow.

Return ONLY a JSON object with this schema:

```json
{
  "decision": "select | reject",
  "reason": "one concise paragraph explaining the decision",
  "evidence": ["resume or job-description fact 1", "resume or job-description fact 2"]
}
```

Rules:

- Use only the provided job description and resume.
- Do not infer protected attributes or personal characteristics.
- Do not invent experience, education, skills, or seniority not present in the resume.
- Select the candidate only when the resume provides enough evidence for the job.

Job description:

{{job_description}}

Candidate resume:

{{resume}}

