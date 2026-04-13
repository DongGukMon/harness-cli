다음 파일을 읽고 컨텍스트를 파악한 뒤 구현을 진행하라:
- Spec: {{spec_path}}
- Plan: {{plan_path}}
- Decision Log: {{decisions_path}}
- Checklist: {{checklist_path}}
{{#if feedback_paths}}
{{feedback_paths}}
{{/if}}

각 태스크 완료 시 반드시 변경사항을 git commit하라. commit 없이 세션을 종료하면 eval gate에서 변경분을 볼 수 없어 run이 실패한다.

구현 완료 후 `.harness/{{runId}}/phase-5.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록한 뒤 세션을 종료하라.
