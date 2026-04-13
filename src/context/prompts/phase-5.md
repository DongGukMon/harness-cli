다음 파일을 읽고 컨텍스트를 파악한 뒤 구현을 진행하라:
- Spec: {{spec_path}}
- Plan: {{plan_path}}
- Decision Log: {{decisions_path}}
- Checklist: {{checklist_path}}
{{#if feedback_paths}}
{{feedback_paths}}
{{/if}}

각 태스크 완료 시 반드시 변경사항을 git commit하라. commit 없이 세션을 종료하면 eval gate에서 변경분을 볼 수 없어 run이 실패한다.

구현 완료 후 `.harness/{{runId}}/phase-5.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.

**CRITICAL: sentinel 파일(phase-5.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 즉시 이 세션이 자동 종료된다. sentinel 이후에는 어떤 작업도 실행되지 않는다.**
