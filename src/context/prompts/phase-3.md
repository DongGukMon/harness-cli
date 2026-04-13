다음 파일을 읽고 컨텍스트를 파악한 뒤 구현 계획을 작성하라:
- Spec: {{spec_path}}
- Decision Log: {{decisions_path}}
{{#if feedback_path}}
- 이전 리뷰 피드백 (반드시 반영): {{feedback_path}}
{{/if}}

plan을 {{plan_path}}에 저장하고,
eval checklist를 {{checklist_path}}에 아래 JSON 스키마로 저장하라:
```json
{
  "checks": [
    { "name": "<검증 항목 이름>", "command": "<실행 커맨드>" }
  ]
}
```
`checks` 배열은 비어있지 않아야 하며 각 항목에 `name`(string)과 `command`(string)이 필수다.

`.harness/{{runId}}/phase-3.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.

**CRITICAL: sentinel 파일(phase-3.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다.**
