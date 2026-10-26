# Submission log

## Step 0 — state
- Read README.md, spec.md, SUBMISSION_TASK.md. 111 source files, all readable (no iCloud eviction → no `_holding/` needed).
- `pnpm install && pnpm test`: initially chat-backend failed (better-sqlite3 11 has no build for Node v26). **Decision:** bumped better-sqlite3 to ^13.0.3 (needs Node ≥22). All tests then pass: core 42, server 4, studio 6, react 7, backend 19.
- `git init`, .gitignore (node_modules, *.db, .env*, dist, *.pem, *.key).
