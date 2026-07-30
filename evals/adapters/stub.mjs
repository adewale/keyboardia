#!/usr/bin/env node
/**
 * Deterministic offline adapter. Calls no model and needs no credentials.
 *
 * Two jobs:
 *   1. CI can exercise the whole pipeline — prompt assembly, grading, severity,
 *      reporting — with no provider and no spend.
 *   2. It is the reference implementation of the adapter contract. If you are
 *      writing an adapter for your own agent, this is the shortest complete
 *      example of the shape it must speak.
 *
 * Contract (shared with skill-eval-harness `run-subagent --agent-cmd`):
 *   stdin   {"prompt": string, "model": string|null, "workspace": string}
 *   stdout  {"answer": string}
 *
 * The answer it returns is canned text, not a judgement about Keyboardia. Never
 * read a stub score as evidence about the skill.
 */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const { prompt } = await readStdin();

// Three prompt shapes reach an adapter: a judge grading request, a trigger
// catalog question, and an ordinary answer case. Handling all three keeps the
// offline run exercising every path the real runner takes.
const answer = prompt.includes('<answer-under-review>')
  ? JSON.stringify({
    passed: true,
    score: 4,
    rationale: 'Stub verdict. Fixed output, not a judgement about the answer.',
  })
  : prompt.includes('<available-skills>')
    ? '["collaborate-in-keyboardia"]'
    : [
      'Stub adapter response. This text is fixed and is not a model output.',
      '',
      'Plan: call get_session, then edit_session, then get_session again to verify.',
      '',
      '```json',
      '{"session_id": "00000000-0000-4000-8000-000000000001",',
      ' "edit": {"operation": "set_steps", "track_id": "user-kick",',
      '  "changes": [{"step": 4, "value": true}, {"step": 12, "value": true}]}}',
      '```',
    ].join('\n');

process.stdout.write(JSON.stringify({ answer }));
