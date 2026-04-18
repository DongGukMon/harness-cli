# Vendored Playbooks

Source: https://github.com/addyosmani/agent-skills (MIT)
Pinned SHA: 9534f44c5448086fcc0046f9d83752c654c81930
Fetched: 2026-04-18

## Files
- `context-engineering.md` ← `skills/context-engineering/SKILL.md`
- `git-workflow-and-versioning.md` ← `skills/git-workflow-and-versioning/SKILL.md`
- `LICENSE-agent-skills.md` ← upstream `LICENSE`

## Sync procedure
1. 이 문서의 "Pinned SHA" 값을 새 SHA로 업데이트.
2. 다음 커맨드로 파일 재다운로드:
   ```bash
   SHA=<NEW_SHA>
   for name in context-engineering git-workflow-and-versioning; do
     curl -fsSL "https://raw.githubusercontent.com/addyosmani/agent-skills/${SHA}/skills/${name}/SKILL.md" -o src/context/playbooks/${name}.md
   done
   curl -fsSL "https://raw.githubusercontent.com/addyosmani/agent-skills/${SHA}/LICENSE" -o src/context/playbooks/LICENSE-agent-skills.md
   ```
3. 이전 버전과 `git diff` 검토. harness와 무관한 외부 툴/프로세스 언급이 있으면 상단에 `> NOTE: Apply principles, not specifics.` 한 줄 추가.
4. `git commit -m "chore(playbooks): bump vendor SHA to <NEW_SHA>"`.
