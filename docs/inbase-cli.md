# InBase cli

The command name is `inbase` (via `npx inbase` or a global install). Run `inbase help` for the same overview in the terminal.

## Project commands

| Command | What it does |
| --- | --- |
| `inbase init <editor>` | Install skills for that editor (`cursor`, `claude`, `agents`, `zed`, `copilot`, `cline`, `opencode`, `lmstudio`, `bionic`); write `inbase.json` if missing (includes `editor` so the map can open files there); gitignore `.inbase/` |
| `inbase cleanup` | Remove installed skills and rules, `.inbase/`, `inbase.json`, and the `.gitignore` entry |
| `inbase cleanup <editor>` | Remove only that editor's skills |
| `inbase run` | Scan the project and start the local map. Maps `target` from `inbase.json`, else the current directory. If a map is already running, prints the URL and exits |
| `inbase run --target <dir>` | Map another folder for this run |
| `inbase run --port <number>` | Start on another port (default: `inbase.json` port, else 5173) |
| `inbase extract-blueprint <folder> <file>` | Scan a folder and print an inventory for `/extract-blueprint`. `--write` saves the curated blueprint |
| `inbase help` | Show CLI help |
