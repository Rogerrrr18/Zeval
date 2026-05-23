# v2 Label Drafts

Each JSON file is intentionally editable by a human labeler.

Import requirements:
- `reviewStatus` must be `approved`.
- `labeler`, `reviewer`, and `reviewedAt` must be filled.
- Every required dimension needs a 1-5 score and non-empty evidence.
- `goalCompletion.status` must be `achieved`, `partial`, `failed`, or `unclear`.
- `recoveryTrace.status` must be `none`, `completed`, or `failed`.
- `recoveryTrace.status=none` requires `qualityScore=0`.
