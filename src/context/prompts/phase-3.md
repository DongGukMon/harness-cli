다음 파일들을 읽고 구현 계획(Implementation Plan)과 평가 체크리스트를 작성하라:
- Spec: {{spec_path}}
- Decision Log: {{decisions_path}}
{{#if feedback_path}}
- 이전 리뷰 피드백 (반드시 반영): {{feedback_path}}
{{/if}}

## 체크리스트 스키마

체크리스트는 다음 JSON 스키마를 따르는 YAML 또는 마크다운 형식으로 작성하라:

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "id": { "type": "string" },
      "description": { "type": "string" },
      "category": { "type": "string", "enum": ["functional", "quality", "security", "performance"] },
      "automated": { "type": "boolean" }
    },
    "required": ["id", "description", "category", "automated"]
  }
}
```

plan을 {{plan_path}}에, checklist를 {{checklist_path}}에 저장하고,
`.harness/{{runId}}/phase-3.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록한 뒤 세션을 종료하라.
