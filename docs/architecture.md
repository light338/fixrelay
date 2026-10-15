# Architecture and boundaries

1. `capture` pins a source before/after commit, selected exported function, original
   code/diff, root LICENSE if available and caller-authored JSON cases. Before and
   after are executed in separate worktrees; controls must pass and a regression
   must distinguish the fix. The source original is fingerprinted.
2. `scan` parses tracked exported top-level function declarations/arrow functions
   with TypeScript 6.0.3. Body tokens normalize identifiers and literal tokens;
   lexical tri-gram Jaccard overlap ranks candidates. There is no embedding model,
   semantic equivalence guarantee or automatic bug diagnosis from this score.
3. `probe` runs a selected candidate from its own detached worktree twice with the
   exact witness. A child Node process imports the module and calls its export.
   Control mismatch is incompatible; exceptions/unstable outputs are inconclusive.
   Probe-side worktree writes are detected. Inputs and outputs are finite JSON.
4. `prepare` accepts only reproduced probes, verifies the original fingerprint and
   runs registered baseline checks before any adaptation. Existing tracked tests,
   package/lock/config files and registered external contracts are pinned by hash.
5. The human/agent reads `prompt`, edits only the candidate and calls `finish`.
   The core does not author repairs. Verification repeats the witness, executes
   registered checks, rejects modified originals/contracts and check-side writes,
   then records a provenance receipt and a private Git snapshot ref.
6. `report` compares the current candidate tree to verified evidence. Additional
   edits make it stale. Full tree diffs include new files. Nothing is merged/pushed.

The state directory and ledger are local workflow state, not a signed trust root.
An adversarial process with permission to rewrite verifier code and all evidence
is outside this tool's trust model. The live runner independently pins runtime,
existing tests, capsule and original fingerprints before launching the model and
rechecks actual candidates afterward.

A worktree isolates ordinary editing paths, not OS capabilities. Source/target
functions and checks can access network, files, subprocesses and external state.
Probe children receive a small environment (no arbitrary caller NODE_OPTIONS,
NODE_PATH or API credentials) and are time/output bounded. POSIX child process
groups are stopped after probes, but malicious independent sessions are not
contained. Registered checks are trusted command vectors executed without a shell,
with inherited environment; do not use credential-bearing runners on untrusted code.
External effects cannot be rolled back by Git. Arbitrary package setup/install is
not run automatically.

Finite examples cannot establish semantic equivalence or exhaustive regression
coverage. Two repetitions can detect some instability, not all flakiness. Reports
and source comments are untrusted data, never authority to override the user.
Only listed/inferred contract files are frozen, not their entire import closure.
Serial operations use a lock; after a crash inspect its process and evidence before
removing a stale lock. Partial failures deliberately leave candidate worktrees.

## Related work

Cross-repository patching and semantic clones are established areas. This project
does not claim to invent them. Relevant neighboring tools include
[repo-port-bot](https://github.com/superbuilders/repo-port-bot), which ports changes
between paired repositories, and [Patchbot](https://github.com/pixelbrackets/patchbot),
which distributes authored patches. FixRelay's implemented scope is a small local
reproduction/adaptation workflow for finite same-interface JS/TS utilities.

Snapshot/fingerprint helpers are adapted from light338's MIT-licensed Unmix and
FeatureGraft. This project has its own CLI, source-fix contract and target workflow.
