{{wrapper_skill}}

---

## Harness Runtime Context (reference)

- runId: `{{runId}}`
- phaseAttemptId: `{{phaseAttemptId}}`
- spec path: `{{spec_path}}`
- plan path: `{{plan_path}}`
- decisions log: `{{decisions_path}}`
- checklist path: `{{checklist_path}}`
{{#if feedback_paths}}
- previous feedback(s):
{{feedback_paths}}
{{/if}}

위 wrapper 스킬의 Process 순서 및 Invariants 섹션(git commit 규율, sentinel 타이밍, HARNESS FLOW CONSTRAINT)을 준수.
