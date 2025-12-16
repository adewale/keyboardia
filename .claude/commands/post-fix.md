# Post-Fix Analysis Command

A bug has been fixed. Now perform a comprehensive post-fix analysis to find similar issues across the codebase.

## Instructions

1. **Understand the fix**: Ask the user (or infer from recent conversation) what the bug was and what pattern caused it.

2. **Extract the pattern**: Identify:
   - The code pattern that caused the bug (e.g., `getInstance()`, `setTimeout without cleanup`)
   - Any risky context that makes the pattern dangerous (e.g., `Tone.`, `audioContext`)
   - The file that was fixed

3. **Run the post-fix analysis tool**:
   ```bash
   cd /Users/ade/Documents/projects/tunejs_implementation/keyboardia/app && npx tsx scripts/post-fix-analysis.ts \
     --pattern "PATTERN_HERE" \
     --risky-context "CONTEXT_HERE" \
     --file "FIXED_FILE" \
     --symptom "SYMPTOM"
   ```

4. **Review high-risk matches**: For any matches marked as HIGH RISK:
   - Read the affected files
   - Determine if they have the same bug
   - Report findings to the user

5. **Update documentation if warranted**: If this is a new bug pattern:
   - Consider adding to `src/utils/bug-patterns.ts`
   - Consider adding to `docs/DEBUGGING-LESSONS-LEARNED.md`
   - Use `npx tsx scripts/bug-capture.ts --interactive` if detailed capture needed

6. **Report to user**:
   - How many similar patterns were found
   - Which are high risk and need review
   - Recommendations for prevention

## Example Usage

User: "I fixed a singleton bug in engine.ts where getInstance() was caching Tone.js nodes"

Response:
1. Run post-fix analysis with pattern `getInstance\(\)` and risky context `Tone\.`
2. Review matches in audio/ directory
3. Report findings

## Arguments

$ARGUMENTS - Optional: Description of the bug that was fixed (pattern, file, symptom)
