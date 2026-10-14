# GSS local conversation — Codex — 2026-10-14

14/10 update: after RAM/disk/official-license preflight, a private pinned Qwen3-4B Q4_K_M/llama.cpp CPU candidate completed actual synthetic loopback inference. [Benchmark](GSS_LOCAL_MODEL_BENCHMARK_2026-10-14_CODEX.json):load8.833s/request11.160s, sampled peakWS4.644GB. Later authenticated owned startup/product-chat/ledger completed at18:14:30, with fresh427-test full source regression at18:20:35. Assets/licenses remain ignored/private, native test process exited, no global install or private `.env` change. Neither single synthetic check is labeled SOC quality or model promotion.

## Status and boundaries

The provider now requires scoped bearer authentication. Optional owned Windows-x64 CPU lifecycle is implemented for the one existing pinned Qwen3-4B/llama.cpp b11609 candidate; defaults disabled, not arbitrary checkpoint selection. Actual UI Conversation+ledger PASS on one synthetic greeting at18:14:30Bangkok:136/19/0 reported input/output/cached tokens,27.251s latency, cost UNKNOWN, tasks/frontiers/decisions0. [Product check](GSS_LOCAL_MODEL_PRODUCT_CHECK_2026-10-14_CODEX.json). This supersedes transport-only testing, NOT SOC quality or promotion. Investigation remains deterministic/evidence-bound; Conversation cannot create facts, dispatch, approve or remediate. [Fresh427-test source verifier](GSS_SOC_VERIFICATION_2026-10-14_MODEL_PRODUCT_CODEX.json) includes the subsequent checksum-bound preflight repair; native proof retains its separate earlier scope. Authenticated persistent here means owned lifetime of the launcher, not installed always-on service or availability guarantee.

No cloud fallback is implemented in lab/replay. Local inference still uses RAM, CPU, electricity and disk. Machine inventory is approximately 31.6 GiB RAM / eight logical CPUs; this is not a throughput benchmark.

## Before enabling

1. Select a llama.cpp release and checkpoint whose license permits the intended use. Record release/version, model source, license and model-file SHA-256. Do not use confidential company data to evaluate an unapproved model.
2. For a manual provider, bind literal loopback, use a strong API key and bounded context/one slot; no LAN exposure. [Pinned server documentation](https://github.com/ggml-org/llama.cpp/blob/b11609/tools/server/README.md) specifies key-file auth and the public health endpoint. Alternatively opt into the owned manager below; no downloads/global install/adoption of an existing port/server.
3. Apply PostgreSQL migration 018 after a local backup. The local provider identifier is `llama.cpp`; existing OpenAI/Groq reservations remain compatible.
4. In the private local environment, explicitly set:

```dotenv
GSS_RUNTIME_ENV=local
GSS_SOC_PROFILE=lab
GSS_LOCAL_CONVERSATION_ENABLED=true
GSS_LOCAL_MODEL_URL=http://127.0.0.1:8080/v1/chat/completions
GSS_LOCAL_CONVERSATION_MODEL=your-reviewed-model-alias
GSS_LOCAL_MODEL_API_KEY=your-private-32-to-128-character-opaque-token
GSS_LOCAL_MODEL_TIMEOUT_MS=20000
```

Use the model alias actually served by the reviewed server. Never add model credentials to browser variables. The provider allows only literal loopback HTTP and the exact completion path: no DNS hostname, URL credentials, redirect, query parameters or external endpoint. A real staging runtime cannot enable this experimental route.

### Optional owned cached CPU runtime

Explicitly set `GSS_LOCAL_MODEL_MANAGED=true`, an absolute private `GSS_LOCAL_MODEL_CANDIDATE_FILE` and its exact raw-byte `GSS_LOCAL_MODEL_CANDIDATE_SHA256`. Candidate/control values stay in the parent launcher. Optional `GSS_LOCAL_MODEL_ASSET_DIR` is an absolute private local source-assets directory, otherwise `GSS_DATA_DIR/models`. The writable data root must exist. Only the previously verified b11609 CPU ZIP digest, Qwen3-4B Q4_K_M weights digest/revision and unpromoted candidate are supported in v1; different models/architectures/unknown licenses fail closed. This does not replace the user's selected Codex model or promote a SOC reasoning model.

Ctrl+Shift+B builds first, waits for Control Plane authority, verifies exact asset sizes/hashes, then extracts the pinned ZIP into a fresh private owned directory (never adopt modified DLLs). At least8GiB available RAM required;2 threads/low priority/no idle polling, context2048/parallel1/predict512, no prompt caching/slots/media paths/remote model auto-download. Thread/context settings are NOT OS-hard memory isolation or a sandbox. Startup is bounded; task/provider/API deadlines remain unchanged. Native child receives no DB/cloud/GSS secrets. It gets a transient key file, not a key in argv; only Conversation receives the bearer, never UI/worker/authority. Authentication is probed against `/v1/models`; `/health` is public and not auth proof. Native output is discarded. Owned process exits stop the stack; shutdown removes only the owned ephemeral credential, keeps original assets/private runtime copies. Single-user Windows file modes are not an organization secret-store/ACL attestation.

Manager stays disabled in current private `.env`; the successful test used an isolated empty schema and one synthetic question only. It did not execute existing tasks, import logs, contact paid providers, modify user runtime or evaluate SOC accuracy.

5. Restart with Ctrl+Shift+B, then try a generic SOC question. Existing deterministic read-only commands retain their separate routing. Do not assume that a displayed reply means evidence was collected.

## Invocation accounting

- One in-flight local conversation call per Command Center process; no automatic retry or paid fallback.
- Input context is budgeted; output is capped at 512 tokens, transport at 64 KiB, timeout at the configured 1–60 seconds.
- The router uses the existing durable model-call gate. If enforced, the local model/provider must match an operator-reviewed budget policy and acquire its reservation before calling the provider.
- Missing usage is recorded as unknown, not zero. No cloud token price is applied to a local model. Cost remains unknown until a reviewed local accounting policy exists; an enforced budget therefore fails closed on unknown settlement. Do not invent a zero price to bypass this boundary.
- A disconnected provider, malformed output, tool call, redirect, truncation or timeout produces an explicit unavailable result. No response is fabricated.

## Required promotion evidence

Use at least 30 permitted, human-labeled SOC cases split in advance into 20 development and 10 holdout. Measure latency, memory, tokens, omissions, unsupported claims and appropriate uncertainty. At least 8/10 holdout cases must meet the roadmap rubric; no fabricated evidence, unauthorized action or unsupported benign conclusion in high-severity cases. A synthetic HTTP fixture tests transport/policy, not these quality requirements. Until then, keep the feature experimental and disabled by default.

To disable: set `GSS_LOCAL_CONVERSATION_ENABLED=false` and restart. This does not delete investigations or change deterministic policy decisions.
