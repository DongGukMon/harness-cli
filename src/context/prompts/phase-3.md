{{wrapper_skill}}

---

## Harness Runtime Context (reference)

- runId: `{{runId}}`
- phaseAttemptId: `{{phaseAttemptId}}`
- spec path: `{{spec_path}}`
- decisions log: `{{decisions_path}}`
- plan output path: `{{plan_path}}`
- checklist output path: `{{checklist_path}}`
{{#if feedback_path}}
- previous feedback: `{{feedback_path}}`
{{/if}}

위 wrapper 스킬의 Process 순서를 준수. Checklist JSON 스키마를 정확히 따르고, sentinel은 최종 단계에서만 생성. HARNESS FLOW CONSTRAINT도 유지.
