# pi-claude-code-auth

A [pi](https://github.com/earendil-works/pi) extension that registers an Anthropic provider authenticated with your existing Claude Code OAuth session. No API key, no browser flow — pi reads the credentials Claude Code already stored on this machine and refreshes them transparently.

---

## Read this before installing

This package uses **non-public Anthropic protocol signals** (Claude Code billing header, `claude-code-*` betas, `mcp_<PascalCase>` tool names, Claude Code identity prefix in `system[]`) to make pi requests look like Claude Code subscription traffic. Anthropic's own documentation explicitly forbids this:

> "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications... Anthropic does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials on behalf of their users. **Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.**"
>
> — [code.claude.com/docs/en/legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)

**Observable enforcement timeline**:

| Date | What changed |
|---|---|
| 2026-01-09 | Anthropic began blocking third-party OAuth against Max plans |
| 2026-04-04 | Subscription coverage cut for OpenClaw / OpenCode / NanoClaw — `400 "out of extra usage"` from those harnesses |
| 2026-06-15 | Subscription Agent SDK / `claude -p` usage moves to a separate monthly credit pool |

**Observable user impact**: the prior-art opencode plugin [`griffinmartin/opencode-claude-auth`](https://github.com/griffinmartin/opencode-claude-auth) has open and closed GitHub issues from users whose Claude accounts were suspended shortly after using the plugin (see issues #74 and #221 there). This package implements the same mechanism.

**Bottom line**:

- Installing this package may get your Claude account suspended.
- Every time Anthropic ships a new server-side validator, this package can stop working until somebody updates the protocol constants in `src/model-config.ts`.
- This package is provided AS-IS under the MIT license, with no warranty, no commitment to keep it working, and no affiliation with Anthropic.
- If you do not have an enterprise context where you can absorb a lost account, **do not install this**.

By installing or using this package you accept these risks. You are responsible for understanding and complying with Anthropic's terms for your subscription tier.

---

## What it does

- Registers a `claude-code` provider inside pi.
- Reads Claude Code OAuth credentials from `~/.claude/.credentials.json` (Linux/Windows) or the macOS Keychain.
- Refreshes the token transparently when it nears expiry, with a `claude -p` CLI fallback when the direct OAuth refresh fails.
- Reshapes every outbound Anthropic Messages request so the server classifies it as a legitimate Claude Code session and bills it against your Claude Code subscription.

Conceptually a port of [`griffinmartin/opencode-claude-auth`](https://github.com/griffinmartin/opencode-claude-auth) to pi's `streamSimple` provider contract.

## Prerequisites

| Requirement | Why |
|---|---|
| [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and on `$PATH` | Token-refresh fallback runs `claude -p . --model haiku` |
| You have logged in to Claude Code at least once (`claude`) | Provides the OAuth credentials this extension reads |
| An active Claude Code subscription | Requests are billed against it |
| Node `>= 22.19.0` | pi runtime requirement |
| [pi](https://pi.dev) installed | This is a pi extension |

If you have never run `claude` on this machine, do that first. There is nothing to reuse otherwise.

## Installation

```sh
pi install npm:@cgaravitoq/pi-claude-code-auth
```

That's it. pi fetches the package, runs `npm install`, and registers the extension in `~/.pi/agent/settings.json`.

## Activation

Inside pi:

```text
/login claude-code
/model claude-code/claude-opus-4-8
```

`/login claude-code` materializes the discovered credentials into `~/.pi/agent/auth.json` (pi's own auth store). It does not open a browser — if no credentials are found it tells you to run `claude` first and aborts.

After that, switch models any time:

```text
/model claude-code/claude-sonnet-4-6
/model claude-code/claude-haiku-4-5
```

## Models supported

| Model ID | Reasoning | Input | Context | Max output |
|---|---|---|---|---|
| `claude-opus-4-8` | yes (adaptive; low, medium, high, xhigh, max) | text, image | 200k | 64k |
| `claude-opus-4-7` | yes | text, image | 200k | 64k |
| `claude-sonnet-4-6` | yes | text, image | 200k | 64k |
| `claude-haiku-4-5` | no | text, image | 200k | 64k |

The cost numbers pi displays come from public pricing tables. Actual billing for Claude Code OAuth requests is governed by your subscription, not by per-token costs.

## How it works

1. **Credentials discovery** (`src/claude-code-creds.ts`) — macOS Keychain entries matching `Claude Code-credentials*`, then `~/.claude/.credentials.json`. Accepts both `claudeAiOauth.{accessToken, refreshToken, expiresAt}` and snake_case shapes.
2. **Refresh** — when the token is within 60s of expiry, `POST https://claude.ai/v1/oauth/token` with the Claude Code client ID. If that fails (refresh token rotated, network), falls back to `claude -p . --model haiku`, which forces the Claude CLI to refresh its own session; then re-reads. Concurrent callers share one in-flight refresh promise. Writes are atomic (`*.tmp` + rename).
3. **Payload reshape** (`src/transforms.ts`) — before each stream, mutates the Anthropic Messages params:
   - Injects an `x-anthropic-billing-header` entry as `system[0]`.
   - Ensures `"You are Claude Code, Anthropic's official CLI for Claude."` is `system[1]` as a dedicated entry.
   - Moves every other system entry into the first user message.
   - Prefixes every tool name with `mcp_<PascalCase>` (e.g. `read` → `mcp_Read`) and rewrites `tool_use` blocks in history accordingly.
   - Strips `thinking.effort` for haiku.
   - Filters orphan `tool_use` / `tool_result` pairs.
4. **Headers** (`src/anthropic-stream.ts`) — sends `anthropic-beta` (computed from `src/model-config.ts`), `user-agent`, `x-app: cli`, and `anthropic-dangerous-direct-browser-access: true`.
5. **Thinking blocks** — assistant `thinking` blocks from previous turns are dropped before send. The signature is bound to the original turn and cannot be revalidated; re-sending it causes the API to reject the request.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_CLI_VERSION` | `2.1.112` (from `src/model-config.ts`) | Version string embedded in the billing header and `user-agent`. Bump this when Anthropic stops accepting the pinned version. |
| `CLAUDE_CODE_ENTRYPOINT` | `sdk-cli` | Entrypoint string in the billing header and `user-agent`. |
| `ANTHROPIC_USER_AGENT` | `claude-cli/<version> (external, <entrypoint>)` | Full override for the `user-agent` header. |

You should not normally need to set any of these. They exist so you can adapt to Anthropic protocol drift without waiting for a release.

## Troubleshooting

### `400 "out of extra usage"` or `400 "credit balance"`

The request reached Anthropic but was not classified as a Claude Code session. Usually one of:

- The billing header (`system[0]`) was missing, malformed, or stripped by a downstream proxy.
- The identity prefix (`system[1]`) was missing.
- The `anthropic-beta` list is stale because Anthropic rotated betas.

Bump `ANTHROPIC_CLI_VERSION` to whatever the latest `claude --version` reports. If still failing, the betas in `src/model-config.ts` likely need updating to match what the real Claude Code CLI sends.

### Signature error on thinking blocks

This extension already drops thinking blocks from prior assistant turns before sending. If you still see the error, you probably have a custom pi flow that re-injects thinking content elsewhere — strip `thinking` blocks before they reach the provider.

### `Claude Code credentials not found`

You have not authenticated Claude Code on this machine. Run `claude`, complete the login flow, then re-run `/login claude-code` in pi.

### Refresh keeps failing

The OAuth refresh endpoint (`https://claude.ai/v1/oauth/token`) is the primary path; the extension falls back to `claude -p . --model haiku` if it rejects the refresh token. The error message now reports the specific reason. If both fail:

- Run `claude` manually and let it re-login.
- Check that `claude` is on `$PATH` for the shell pi was launched from (`command -v claude`).
- Verify `~/.claude/.credentials.json` exists and is readable.

### Haiku ignores `effort` / `reasoning`

Intentional. `src/model-config.ts` disables `effort` and excludes the interleaved-thinking beta for haiku, which does not support reasoning.

## Credits

- [`griffinmartin/opencode-claude-auth`](https://github.com/griffinmartin/opencode-claude-auth) — original opencode plugin this extension is ported from. All of the protocol-level work (billing header layout, beta set, identity split, tool prefixing) is theirs.
- pi's [`examples/extensions/custom-provider-anthropic`](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions/custom-provider-anthropic) — base Anthropic streaming implementation.

## License

MIT. See [LICENSE](LICENSE).
