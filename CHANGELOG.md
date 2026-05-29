# Changelog

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
