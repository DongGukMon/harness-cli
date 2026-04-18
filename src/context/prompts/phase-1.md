다음 파일에서 태스크 설명을 읽고 요구사항을 분석한 뒤 설계 스펙과 Decision Log를 작성하라:
- Task: {{task_path}}
{{#if feedback_path}}
- 이전 리뷰 피드백 (반드시 반영): {{feedback_path}}
{{/if}}

spec을 {{spec_path}}에, decision log를 {{decisions_path}}에 저장하고,
`.harness/{{runId}}/phase-1.done` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.

**CRITICAL: sentinel 파일(phase-1.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 이후 하네스는 다음 단계(리뷰/피드백)로 넘어가므로 추가 작업을 하지 말 것.**

spec 문서는 "{{spec_path}}" 경로에 작성하고, 상단에 "## Context & Decisions" 섹션을 포함하라.
decisions.md는 "{{decisions_path}}" 경로에 작성하라.
