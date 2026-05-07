# Production Inconsistency Fixes

## Progress

- [x] **Fix A**: runId propagation — pipelineRunId used everywhere
  - [x] evaluateTruth() now uses pipelineRunId (line 917)
  - [x] optimizer now uses pipelineRunId (line 964)
  - [x] fuseSignals() already receives pipelineRunId correctly

- [x] **Fix B**: stale agent state cleanup
  - [x] agent-state.json sanitization (test-run-*, empty, undefined) — lines 721-743
  - [x] runtime/state.json sanitization (stale activeRunId, consecutiveFailures) — lines 745-770

- [x] **Fix C**: webhook secret alignment — Code.gs
  - [x] Auto-bootstrap with verification loop (3 attempts with sleep/retry)
  - [x] Same shared secret: `89e9d1671f9a13dbd3cbdc5fd90a2fdecaff7a5d635b81aa`

- [x] **Fix D**: truth evaluator git verification
  - [x] `git branch -r --contains <hash>` check to verify commit was pushed
  - [x] `pushedToRemote` boolean eliminates false negatives

## Verification

- [ ] Run: `node operator/operator.js daily-newsletter`
