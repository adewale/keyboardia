# Hidden split prompts

`shared-benchmark.json` references prompts in this directory through `prompt_ref`
instead of inlining them. The prompt files themselves are git-ignored.

A case whose text never entered the skill, the docs, or the tune cases cannot
have been tuned against. That is the only thing separating a score that is
evidence from a score that is a rehearsal.

- `evals/holdout/` — scored at the end of a round, after tune iteration stops.
- `evals/holdback/` — withheld from the skill, the docs, and the tune cases
  until after scoring. Use it to detect memorization.

## Writing one

Each file is a JSON object with a single `prompt` string:

```json
{
  "prompt": "Read the attached Keyboardia MCP schema fixture. ..."
}
```

The manifest already declares which files it expects; run
`node evals/run-benchmark.mjs --agent <name> --split holdout` and the runner
names any that are missing. Missing hidden prompts are skipped with a notice
rather than failing the run, so a fresh clone still works — the tune split is
fully self-contained.

## Don't commit them

`.gitignore` in this directory excludes `*.json`. Keep the real prompts wherever
your team keeps private test data. If a holdout prompt lands in the repository,
it has become a tune case: relabel it honestly rather than continuing to report
it as held out.
