다음 파일들을 읽고 구현 계획에 따라 코드를 작성하라:
- Plan: {{plan_path}}
- Checklist: {{checklist_path}}
{{#if feedback_path}}
- 이전 리뷰 피드백 (반드시 반영): {{feedback_path}}
{{/if}}

구현이 완료되면 변경사항을 git commit하라. 커밋 메시지는 구현 내용을 간결하게 요약한다.

`.harness/{{runId}}/phase-5.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록한 뒤 세션을 종료하라.
