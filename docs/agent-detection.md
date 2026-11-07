# Agent Detection & Event Tracking

TmuxAtlas uses a multi-layered approach to detect AI coding agents running in tmux panes and track their state. This document describes how each agent is detected, what events they produce, and how "waiting for input" state is determined.

## Statuses

Every agent pane has exactly one status, kept until it changes:

| Status | Meaning | Shown as |
|--------|---------|----------|
| `active` | The agent is producing its answer | En cours |
| `waiting` | The agent is blocked on a question or an approval | En attente |
| `completed` | The agent finished its work and sits at its prompt | Terminé |
| `idle` | The agent is open but has not been given any work | Inactif |
| `error` | A hook reported an error; kept until the agent works again | Erreur |

Only `waiting` and `error` are alerts a user can dismiss.

## Detection Layers

| Layer | Mechanism | Latency |
|-------|-----------|---------|
| **Hooks** | Agent calls `tmuxatlas notify` | Instant |
| **Watcher** | Reads each agent pane every 2 seconds (`pkg/toolevents/watcher.go`) | ~2s |

Hooks are the fastest signal. The watcher corrects what they cannot report, such as an approval given, an interrupted turn or an agent started before TmuxAtlas.

## Per-Agent Breakdown

### Claude Code

**Detection:** Hooks and screen reading.

**Hooks configured** (`~/.claude/settings.json`):
- `PreToolUse` → `active` ("Using tool")
- `PostToolUse` → `active` ("Working")
- `Notification` (permission_prompt) → `waiting` ("Permission needed")
- `Notification` (elicitation_dialog) → `waiting` ("Needs input")
- `Stop` → `completed` ("Task complete"), or `active` ("Travail en arrière-plan") when the screen shows background work

**Waiting detection:** Hooks, confirmed by the dialog on screen. The screen also clears the status as soon as the dialog closes, and catches question dialogs that send no notification.

**Process tree match:** Binary named `claude`.

### Codex

**Detection:** Screen reading, plus a hook for completion.

**Hook configured** (`~/.codex/config.toml`):
- `notify = ["tmuxatlas", "notify", "-t", "codex", "--event-data"]`
- Fires on `agent-turn-complete` → `completed` status
- Message extracted from `last-assistant-message` field (truncated to 200 chars)

**Waiting detection:** The watcher reads the approval prompt on screen.

**Process tree match:** Binary named `codex`, or node script with "codex" in the path (e.g., `node /usr/lib/node_modules/@openai/codex/bin/codex.js`).

### GitHub Copilot CLI

**Detection:** Hook-based. Without hooks, judged from its output and visible prompts.

**Hooks configured** (`~/.copilot/hooks/tmuxatlas.json`):
- `sessionStart` → `active` ("Session started")
- `sessionEnd` → `completed` ("Session ended")
- `preToolUse` → `active` ("Using tool")
- `postToolUse` → `active` ("Working")
- `userPromptSubmitted` → `active` ("Thinking")
- `errorOccurred` → `error` ("Error occurred")

**Waiting detection:** Without a hook that reports it, a visible prompt after 10 seconds of silence.

**Note:** Repository-level hooks (`.github/copilot/hooks.json`) take precedence over global hooks and can override them.

**Process tree match:** Binary named `copilot`, or node script with "copilot" in the path.

### OpenCode

**Detection:** Hook-based (native waiting) via plugin system.

**Plugin configured** (`~/.config/opencode/plugins/tmuxatlas.js`):
- `permission.asked` → `waiting` ("Permission needed")
- `permission.replied` → `active` ("Working")
- `tool.execute.before` → `active` ("Using tool")
- `tool.execute.after` → `active` ("Working")
- `session.idle` → `completed` ("Idle")
- `session.error` → `error` ("Error")

**Waiting detection:** Native — OpenCode sends explicit `waiting` events via the `permission.asked` hook when it needs user approval.

**Process tree match:** Binary named `opencode`.

## How Each Layer Works

### Hooks

Agents call `tmuxatlas notify` which sends an event only through the current user's private Unix socket. The notify command auto-detects the tmux session, window, and pane from the `TMUX_PANE` environment variable.

```
Agent hook → tmuxatlas notify → unix socket → POST /api/tool-event → Tracker.Record() → WebSocket broadcast
```

Repeating the current status is ignored: "waiting since" keeps its original time and subscribers only hear about changes.

### Watcher

On each cycle the watcher lists all panes and, for each one running an agent (foreground command or process tree), captures the screen and classifies it (`pkg/toolevents/screen.go`):

- **Claude Code:** the input box is the anchor. With it, a spinner line above means working, otherwise ready. Below the rule that closes the box, background shells or agents (`· 2 shells ·`, `3 active agents`, `↓ to manage`) or an automatic continue after a usage limit (`Continuing automatically`) mean working: Claude ends its turn, and fires `Stop`, while that work goes on. Without it, a menu or dialog footer means waiting. The conversation above is not trusted, since it may quote any of these strings.
- **Codex:** `esc to interrupt` means working, an approval prompt without composer means waiting, the `›` composer means ready.
- **Other tools:** their hooks decide when they have any. Otherwise recent output means working, and silence means waiting if a prompt is visible, ready if not.

A screen with no positive evidence keeps the last status. Two captures in a row must show the prompt before a turn counts as finished. A status from a hook is not overridden for 3 seconds, except by a visible dialog.

The first status seen for an agent is marked `baseline`: it describes an existing situation, so it triggers no notification after a restart.

The watcher removes the status when the pane closes, when its foreground returns to a shell, or when it moves to another session or window.

## Multi-Host Considerations

In hub/peer topologies, events need the host identity for correct frontend navigation. The server stamps `Host` and `HostName` on events received via the HTTP API. The watcher has their host identity set at startup via `SetHost()`.

Events without host info will navigate to local sessions only, which breaks in multi-host setups where the session might be on a remote peer.
