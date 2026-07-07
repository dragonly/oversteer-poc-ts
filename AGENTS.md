# AGENTS.md — oversteer-poc-ts

## Workflow

- **Use a git worktree for feature development.** Do not develop features directly on `master`. For each feature/fix, create a dedicated worktree on its own branch, e.g. `git worktree add ../oversteer-poc-ts-<feature> -b feat/<feature>`, work there, then when done merge back to `master` (`git merge --no-ff feat/<feature>`), push `master`, and clean up (`git worktree remove ...` + delete the branch). This keeps `master` clean and lets multiple features/agents progress in parallel without stepping on each other.
