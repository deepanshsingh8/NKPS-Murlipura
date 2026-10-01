# Lessons

## Check the package manager before suggesting install commands
- **Mistake:** Told the user to run `npm install` after a pull. This repo is a pnpm workspace (`pnpm-lock.yaml`, `pnpm-workspace.yaml`, `"packageManager": "pnpm@…"`), and npm crashed with `Cannot read properties of null (reading 'matches')` on pnpm's symlinked `node_modules`.
- **Rule:** Before recommending any install/run command, check the lockfile and `packageManager` field. Here: `pnpm install`, `pnpm --filter @nkps/website run dev`, etc. Never `npm install`.
