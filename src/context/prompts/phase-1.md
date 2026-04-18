{{wrapper_skill}}

---

## Harness Runtime Context (reference)

- runId: `{{runId}}`
- phaseAttemptId: `{{phaseAttemptId}}`
- task spec path: `{{task_path}}`
- spec output path: `{{spec_path}}`
- decisions log path: `{{decisions_path}}`
{{#if feedback_path}}
- previous feedback: `{{feedback_path}}`
{{/if}}

위 wrapper 스킬을 먼저 읽고 Process 순서 그대로 따른다. Invariants 섹션의 sentinel 규칙과 HARNESS FLOW CONSTRAINT를 반드시 준수.
