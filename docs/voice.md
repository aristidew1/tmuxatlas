# Voice input from the browser

Programs on the server that capture from the default audio device, such as Claude Code `/voice`, need a microphone, and a remote server has none. With `TMUXATLAS_VOICE=on`, TmuxAtlas gives the server a virtual microphone fed by the browser.

```
browser mic → /ws/mic → pacat → PulseAudio null sink "atlas_mic" → monitor source → ALSA pulse plugin → SoX
```

## Setup

```bash
sudo apt-get install -y sox pulseaudio pulseaudio-utils libasound2-plugins
```

Set `TMUXATLAS_VOICE=on` for the TmuxAtlas service and restart it. At startup, and for each microphone stream, TmuxAtlas:

- starts PulseAudio for its user if needed
- creates the `atlas_mic` null sink and makes its monitor the default source
- unloads `module-suspend-on-idle`, which would clip the start of dictation
- creates `~/.asoundrc` so ALSA clients use PulseAudio; an existing file that routes elsewhere is left alone and reported as an error in the Terminal toolbar

Run the agent as the same user as TmuxAtlas, since PulseAudio and `~/.asoundrc` are per user.

## Usage

The microphone turns on when you open a local session; the browser asks for permission once. **● Mic on** turns it off, and this browser remembers that choice until you turn it back on. If the stream is interrupted, click **Mic** to restart it.

Claude Code needs voice enabled in hold mode, its default. Run `/voice hold` once if it is not; the setting persists.

1. Click **Talk** in the status bar below the Terminal. It is active only while Claude Code runs in the active pane. TmuxAtlas holds the space bar until you stop, so you can release the button while you speak.
2. When you finish, click one of the two buttons that replace **Talk**:
   - The **square** stops recording and leaves the transcription in the prompt, so you can edit it and press Enter.
   - The **arrow** stops recording and sends the prompt once Claude has inserted the transcription. If Claude was not listening or could not transcribe, nothing is sent.

## Limits

- **Local sessions only.** The button appears only for sessions on the machine serving the page. Sessions on other hosts are not relayed.
- **Secure context.** Browsers allow the microphone only over HTTPS or on `localhost`.
- **One stream per host.** The newest tab takes over and the previous one stops.
- **Claude prompt and default key binding.** **Talk** repeats the space bar on the server, because Claude treats a 200 ms gap as a release. It needs Claude's prompt and the default `space` binding; in a Claude dialog or the transcript viewer, the spaces act as key presses there. The arrow also reads Claude's footer on screen, so a Claude Code update that rewords it could stop the arrow from working.

Audio is forwarded to the host in real time while the microphone is on, whether or not you are dictating, and is never stored.

## Troubleshooting

| Symptom | Check |
|---|---|
| `/voice` cannot open an audio device | `pactl info` shows `Default Source: atlas_mic.monitor`, and `~/.asoundrc` contains `pcm.!default { type pulse }` |
| No microphone button | `curl localhost:7654/api/voice` returns `"enabled":true`, and the session is on the local host |
| Recording is silent | `rec -q test.wav trim 0 3` while **Mic** is on, then `sox test.wav -n stat` |
| Wrong language | Change the dictation language in Claude Code with `/config` |
