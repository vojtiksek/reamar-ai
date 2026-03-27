# Mac mini — Autostart Setup

Backend and frontend start automatically at login via macOS launchd user agents.

## Architecture

| Agent | Plist | Script | Port |
|---|---|---|---|
| `com.reamar.backend` | `~/Library/LaunchAgents/com.reamar.backend.plist` | `scripts/launchd_backend.sh` | 8001 |
| `com.reamar.frontend` | `~/Library/LaunchAgents/com.reamar.frontend.plist` | `scripts/launchd_frontend.sh` | 3001 |

- DB (Docker/OrbStack) starts automatically via `restart: unless-stopped` in docker-compose.yml
- Backend wrapper waits up to 60s for DB to be ready before starting uvicorn
- launchd runs both processes as foreground daemons and restarts on crash

## Logs

```
~/reamar-ai/logs/backend.log    — uvicorn output
~/reamar-ai/logs/frontend.log   — Next.js output
~/reamar-ai/logs/autostart.log  — startup sequence log
```

## Status check

```bash
launchctl list | grep reamar
# Expected: PID  0  com.reamar.backend
#           PID  0  com.reamar.frontend
# (PID = running process ID, exit code 0 = last run OK)
```

## Stop services

```bash
launchctl stop com.reamar.backend
launchctl stop com.reamar.frontend
# or use the manual script (also works fine alongside launchd):
~/reamar-ai/scripts/stop_stack.sh
```

## Start services manually (if launchd stopped them)

```bash
launchctl start com.reamar.backend
launchctl start com.reamar.frontend
```

## Disable autostart

```bash
launchctl unload ~/Library/LaunchAgents/com.reamar.backend.plist
launchctl unload ~/Library/LaunchAgents/com.reamar.frontend.plist
```

## Re-enable autostart

```bash
launchctl load ~/Library/LaunchAgents/com.reamar.backend.plist
launchctl load ~/Library/LaunchAgents/com.reamar.frontend.plist
```

## Reinstall from scratch (e.g. after new Mac setup)

```bash
# 1. Install OrbStack, Python 3.11, Node via Homebrew
# 2. Clone repo: git clone git@github.com:vojtiksek/reamar-ai.git ~/reamar-ai
# 3. Setup backend venv:
cd ~/reamar-ai/backend
/opt/homebrew/bin/python3.11 -m venv .venv
source .venv/bin/activate && pip install -e .

# 4. Install frontend deps:
cd ~/reamar-ai/frontend && npm install

# 5. Copy plist files from docs/launchd/ to ~/Library/LaunchAgents/
# 6. Load agents:
launchctl load ~/Library/LaunchAgents/com.reamar.backend.plist
launchctl load ~/Library/LaunchAgents/com.reamar.frontend.plist
```

## Plist templates

Generic templates (without hardcoded paths) are in `docs/launchd/`.
The installed versions in `~/Library/LaunchAgents/` are machine-specific and not committed to git.
