# Changelog

## [2.5.0] - 2026-09-08

### Changed
- Replace `claude-fable-5` with `claude-fable-5-1` (Claude Fable 5.1); same tier, 1M context, 128k max output, and $10/$50 per MTok
- `claude-fable-5-1` reads cache at $0.25/MTok (0.025x base input) instead of the 0.1x every other model in the list uses

### Fixed
- Correct `claude-sonnet-5` pricing to $2/$10 per MTok. 2.3.0 carried over Sonnet 4.6's $3/$15

### Notes
- No `@cgaravitoq/claude-code-core` bump needed: `getModelOverride` matches by substring, so the existing `fable-5` override already resolves `claude-fable-5-1` to adaptive thinking
- Fable 5.1 rejects forced `tool_choice` (`any` / `tool`) with a 400; this extension never sets it
- Fable 5.1 is a Covered Model - an org or workspace without 30-day data retention gets a `400 invalid_request_error`
- Verified end to end against the live API through pi: the Claude Code OAuth subscription does serve `claude-fable-5-1`, but the request must advertise Claude Code 2.1.251 or newer. `claude-code-core@0.3.0` reports `2.1.112` and gets `400 claude_code_version_too_old`; set `ANTHROPIC_CLI_VERSION` until `ccVersion` is bumped upstream

## [2.4.0] - 2026-07-24

### Added
- Support for `claude-opus-5` (Claude Opus 5) and `claude-fable-5` (Claude Fable 5); both adaptive-thinking only, 1M context, 128k max output
- Neither model gets the `context-1m-2025-08-07` beta: they ship 1M context by default

### Fixed
- Bump `@cgaravitoq/claude-code-core` to `^0.3.0`. The old `^0.1.0` range pinned 0.1.x, which had no `sonnet-5` override, so `claude-sonnet-5` fell back to `thinking.budget_tokens` and returned a 400 whenever reasoning was enabled

### Notes
- When no reasoning level is requested, no `thinking` field is sent. On Opus 5 and Fable 5 the model still thinks — adaptive is the default on Opus 5 and always-on on Fable 5. This is expected, not a bug

## [2.3.0] - 2026-07-03

### Changed
- Replace `claude-sonnet-4-6` with `claude-sonnet-5` (Claude Sonnet 5); pricing, 1M context, and 128k max output are unchanged

## [2.1.0] - 2026-05-29

### Changed
- Advertise 1M context and 128k max output for `claude-opus-4-8`, `claude-opus-4-7`, and `claude-sonnet-4-6`
- Send the Claude Code 1M context beta for Opus 4.8, Opus 4.7, and Sonnet 4.6
- Use adaptive thinking for `claude-opus-4-7`
- Keep `claude-haiku-4-5` at 200k context and 64k max output

## [0.2.0] - 2026-05-29

### Added
- Support for `claude-opus-4-8` with adaptive thinking and effort levels
- `xhigh` and `max` thinking budgets
- Unit tests for transforms, signing, and model-config

### Fixed
- message_delta no longer zeroes usage fields populated by message_start
- Thinking-only assistant turns preserved with placeholder so role alternation holds
- repairToolPairs no longer drops messages and breaks user/assistant alternation
- Post-stream abort race no longer discards completed responses
- Tool-use partialJson parse failures surfaced via diagnostic field and warn log
- OAuth expires_in coerced to number (was producing NaN expiresAt)
- macOS keychain reads bounded with 5s timeout
- OAuth refresh diagnostics preserved when CLI fallback fails

### Changed
- ModelConfig arrays readonly; config and nested overrides frozen
- computeBetas moved to model-config.ts with deduplication
- applyClaudeCodeTransforms returns mutated params (mutation contract in JSDoc)
- Removed unreachable non-OAuth branch and unused parameters
- Internal signing/transforms helpers unexported to shrink public surface

## [0.1.0]

Initial release.
