# Claude session JSONL fixtures

Fixtures for `src/runners/claude-usage.ts` parser. Each `*.jsonl` mirrors the
format written by `claude` at `~/.claude/projects/<encodedCwd>/<sessionId>.jsonl`.

Only `type: assistant` entries with `message.usage.*_tokens` contribute to
aggregation. Everything else (queue-operation, user, system) is ignored.
