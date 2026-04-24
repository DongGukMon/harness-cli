다음 파일을 읽고 컨텍스트를 파악한 뒤 구현을 진행하라:
- Combined Design Spec (light): {{spec_path}}
- Decision Log: {{decisions_path}}
- Checklist: {{checklist_path}}
{{#if feedback_paths}}
{{feedback_paths}}
{{/if}}

결합 문서의 `## Implementation Plan` 섹션을 구현 roadmap으로 사용한다. 별도 plan 파일은 존재하지 않는다.

각 태스크 완료 시 반드시 변경사항을 git commit하라. commit 없이 세션을 종료하면 eval gate에서 변경분을 볼 수 없어 run이 실패한다.

구현 완료 후 `{{sentinel_path}}` 파일을 생성하되 내용으로 '{{phaseAttemptId}}' 한 줄만 기록하라.

**CRITICAL: sentinel 파일(phase-5.done)은 모든 작업(파일 작성, git commit 포함)이 완료된 후 가장 마지막에 생성하라. sentinel 생성 이후 하네스는 다음 단계(리뷰/피드백)로 넘어가므로 추가 작업을 하지 말 것.**

**HARNESS FLOW CONSTRAINT**: 이 세션은 orchestrated harness 라이프사이클(light flow) 내부에서 실행된다. 다음 phase에서 Codex 기반 독립 reviewer가 산출물을 검토한다(Gate 7). 따라서:
- `advisor()` 툴을 호출하지 말 것. 외부 리뷰가 이미 예약되어 있다.
- 작업 범위는 이 프롬프트가 지시한 산출물(git commits + sentinel)로 제한한다.
- skill 자동 로드는 허용. 그러나 의사결정을 advisor에 위임하지 말고 자체적으로 결론을 낸다.
