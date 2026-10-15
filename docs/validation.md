# Recorded live validation

A real authenticated Codex CLI adapted one source CSV quoting fix into three independently written local JS/TS fixture implementations. These are authored fixture inputs, not independently selected projects or external users. No target repair implementations were supplied to the live runner.

| Target | Export | Before | After | Verification |
|---|---|---|---|---|
| billing | encodeCell | reproduced | not_reproduced | checks_passed |
| crm | serializeField | reproduced | not_reproduced | checks_passed |
| exporter | escapeRecordValue | reproduced | not_reproduced | checks_passed |

Eight frozen JSON cases ran per target: five controls and CR/LF/CRLF regression cases. Codex added target regression tests and preserved each implementation's existing API/style. Existing tracked tests and originals remained unchanged. After the model completed, the runner independently repeated actual probes/checks and compared originals, pinned witness and verifier hashes.

Negative controls: already-fixed → not_reproduced; unrelated → incompatible; broken-import → inconclusive. The ranking gave the already-fixed function the highest lexical score, illustrating why similarity is not a bug verdict.

[Full sanitized evidence](validation-v0.1.0.json) · [Interactive recorded report](index.html)

The opt-in runner consumes existing Codex account capacity. It used installed CLI 0.162.0-alpha.17.2 and Node 24.19.0 in this desktop executor. Its child sandbox override was used only within the executor's separately enforced filesystem sandbox; it is not recommended for an ordinary unconfined terminal. No universal behavior-preservation or sandbox-security claim is made.
