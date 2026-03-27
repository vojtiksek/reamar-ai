# AI-Assisted Development Workflow

## Setup
| Machine | Role |
|---|---|
| MacBook | Primary coding machine |
| Mac mini | Shared DB host + always-on app server |

Both machines auto-pull from `main` every 2 minutes when working tree is clean.

---

## Daily workflow

### 1. Start coding (MacBook)
```bash
cd ~/Desktop/reamar_ai
git pull origin main          # sync before starting
cd backend && bash dev        # start backend
cd ../frontend && npm run dev # start frontend
```

### 2. AI makes changes
- AI reads files, makes targeted edits
- After backend changes: `scripts/dev_check.sh`
- After frontend changes: check browser for errors

### 3. Verify & commit
```bash
scripts/dev_check.sh          # runs tests + git status
git add <specific files>
git commit -m "short description of what and why"
```

### 4. Push
```bash
scripts/prepush_check.sh      # final check before push
git push origin main
```

---

## Machine roles

**Always code on MacBook.**
Mac mini is the DB host. You can also run the full stack there for testing, but primary development happens on MacBook.

**Avoid editing on both machines simultaneously** — auto-pull will skip if there are uncommitted changes, creating drift.

---

## DB migration workflow

```bash
# 1. Make model changes in backend/src/app/models.py
# 2. Generate migration
cd backend && source .venv/bin/activate
alembic revision --autogenerate -m "add_column_xyz"

# 3. Review the generated file in alembic/versions/

# 4. Apply locally
alembic upgrade head

# 5. Commit migration file
git add alembic/versions/<new_file>.py
git commit -m "migration: add_column_xyz"
git push origin main

# 6. Mac mini picks it up via auto-pull and you run:
#    alembic upgrade head  (on Mac mini)
```

**Never run alembic upgrade on Mac mini without committing the migration first.**

---

## Avoiding sync conflicts

| Situation | Action |
|---|---|
| Auto-pull skipping on Mac mini | Commit or stash changes, or run `scripts/stop_stack.sh` first |
| Both machines have local changes | Commit on MacBook → push → Mac mini auto-pulls |
| Merge conflict | Resolve on MacBook, push clean |

---

## Recovery

### Bad code change
```bash
git log --oneline -5          # find last good commit
git revert HEAD               # safe undo (creates new commit)
git push origin main
```

### Broken DB after bad migration
```bash
# Restore from latest backup
ls ~/reamar-ai/backups/
~/.orbstack/bin/docker cp ~/reamar-ai/backups/<latest>.dump reamar_postgres:/tmp/
~/.orbstack/bin/docker exec reamar_postgres pg_restore \
  -U reamar -d reamar --clean --if-exists --no-owner /tmp/<latest>.dump
```

### Backend won't start
```bash
tail -50 ~/reamar-ai/logs/backend.log
cd backend && source .venv/bin/activate && python -m pytest tests/ -x -q
```

---

## Key rules

1. **MacBook = coding, Mac mini = DB host**
2. **Commit before switching machines**
3. **Run `dev_check.sh` before every commit**
4. **Never push broken migrations**
5. **DB backups run daily at 3:00 AM automatically**
