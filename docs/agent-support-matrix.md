# Agent Support Matrix

## TmuxAtlas Hub/Agent runtime compatibility

| Hub runtime | Agent runtime | State sync | Session actions | Remote PTY |
|---|---|---|---|---|
| v1 | v1 with negotiated capability | Yes | Yes | Yes |
| v1 | v1 without optional capability | Yes | Explicit `capability-unsupported` | Explicit `capability-unsupported` |
| v1 | legacy/no hello | No | No | No |
| legacy | v1-only Agent | Unsupported mixed-version deployment | No | No |

Upgrade the Hub first and all Agents immediately afterward. During that window,
legacy Agents are deliberately offline. Use the Hub `/api/hosts` response to
check build version, `runtime_protocol`, `generation`, and `capabilities`.
Hub and Agents must be rolled back as a matching set.

## Support Tiers

| Agent | Support Level | Detection | Waiting Detection | Latency |
|-------|--------------|-----------|-------------------|---------|
| **Claude Code** | **Full (Native)** | Hooks + screen | Native hooks + screen | <1-2s |
| **OpenCode** | **Full (Native)** | Plugin-based hooks | Native hooks | <1-2s |
| **GitHub Copilot CLI** | **Partial (Hybrid)** | Hooks + process tree | Visible prompt after silence | ~10s |
| **Codex** | **Full (Screen)** | Hook + screen | Screen | ~2s |

## Feature Breakdown

| Feature | Claude | OpenCode | Copilot | Codex |
|---------|--------|----------|---------|-------|
| Auto-detection (process tree) | Yes | Yes | Yes | Yes |
| Hook-based activity tracking | Yes | Yes | Yes | Limited (turn-complete only) |
| Native waiting state | Yes | Yes | No | No |
| Tool use events | Yes | Yes | Yes | No |
| Thinking/working events | Yes | Yes | Yes | No |
| Permission prompt detection | Native + screen | Native | Silence-based (~10s) | Screen (~2s) |
| Completion events | Native | Native | Native | Native |
| Error events | No | Native | Native | No |
| Push notifications on waiting | Instant | Instant | Delayed (~10s) | ~2s |
| Auto setup (`tmuxatlas agent-setup`) | Yes | Yes | Yes | Yes |

## Detection Layers

1. **Hook-based** (<1-2s) — Agent calls `tmuxatlas notify` via configured hooks, which spawns a CLI process, delivers via Unix socket, and broadcasts over WebSocket. Claude and OpenCode get full granular events including explicit "waiting" states.
2. **Watcher** (~2s) — Reads each agent pane every 2 seconds, found through its foreground command or `/proc`. It classifies the screen as working, waiting or ready, and clears the status when the agent exits. See [Agent detection](agent-detection.md).

## Why Claude Has Best Support

Claude Code has native hook support for every lifecycle event — `PreToolUse`, `PostToolUse`, `Notification` (permission prompts, input dialogs), and `Stop`. This means TmuxAtlas knows within seconds when Claude is thinking, using a tool, waiting for permission, or done. No polling, no guessing.

## Why OpenCode Is Close Behind

OpenCode has a JavaScript plugin system that fires events for `permission.asked`, `permission.replied`, `tool.execute.before/after`, `session.idle`, and `session.error`. This gives comparable instant tracking to Claude.

## How We Support Other Agents

Copilot and Codex lack native "waiting" hooks:

- **Codex** only fires a single `agent-turn-complete` hook. The watcher knows its screen layout, so it reads working, waiting and ready states directly.
- **Copilot** has hooks for `sessionStart/End`, `preToolUse`, `postToolUse`, and `userPromptSubmitted`. They decide its status when present. Otherwise recent output means working, and silence means waiting if a prompt is visible.
