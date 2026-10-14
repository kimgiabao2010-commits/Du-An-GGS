# GSS local conversation — Codex — 2026-10-14

14/10 update: after RAM/disk/official-license preflight, a private pinned Qwen3-4B Q4_K_M/llama.cpp CPU candidate completed actual synthetic loopback inference. [Benchmark](GSS_LOCAL_MODEL_BENCHMARK_2026-10-14_CODEX.json):load8.833s/request11.160s, sampled peakWS4.644GB. Native model exited; no global install or private `.env` change. This supersedes NOT RUN for native inference only, not for product-chat/ledger integration, labeled SOC quality or model promotion. Assets/licenses are in ignored `data/models`, not Git; persistent authenticated model startup remains unfinished.

## Status and boundaries

The loopback provider and durable invocation integration are implemented and tested against a local HTTP test server. **No real model checkpoint has been installed, benchmarked or promoted.** This is not a SOC model-quality pass. Investigation remains the deterministic, evidence-bound planner; conversation output is labeled unverified commentary and cannot create evidence, dispatch a worker, approve or remediate.

No cloud fallback is implemented in lab/replay. Local inference still uses RAM, CPU, electricity and disk. Machine inventory is approximately 31.6 GiB RAM / eight logical CPUs; this is not a throughput benchmark.

## Before enabling

1. Select a llama.cpp release and checkpoint whose license permits the intended use. Record release/version, model source, license and model-file SHA-256. Do not use confidential company data to evaluate an unapproved model.
2. Run the reviewed `llama-server` bound to `127.0.0.1`, with a bounded context and one parallel slot. Do not expose it to the LAN. Consult the [official server documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md) for the selected version's options and `/v1/chat/completions` behavior. GSS does not download or manage the model process.
3. Apply PostgreSQL migration 018 after a local backup. The local provider identifier is `llama.cpp`; existing OpenAI/Groq reservations remain compatible.
4. In the private local environment, explicitly set:

```dotenv
GSS_RUNTIME_ENV=local
GSS_SOC_PROFILE=lab
GSS_LOCAL_CONVERSATION_ENABLED=true
GSS_LOCAL_MODEL_URL=http://127.0.0.1:8080/v1/chat/completions
GSS_LOCAL_CONVERSATION_MODEL=your-reviewed-model-alias
GSS_LOCAL_MODEL_TIMEOUT_MS=20000
```

Use the model alias actually served by the reviewed server. Never add model credentials to browser variables. The provider allows only literal loopback HTTP and the exact completion path: no DNS hostname, URL credentials, redirect, query parameters or external endpoint. A real staging runtime cannot enable this experimental route.

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
