# MediCrypt 🔐🩺

**Private, on-chain AI symptom triage — built on [Ritual Chain](https://ritualfoundation.org).**

MediCrypt lets a user describe their symptoms and get an AI triage (risk level, plain-language
explanation, advice, and whether to see a doctor) **where the answer is encrypted so only the
user can read it**. Inference runs inside Ritual's TEE-backed LLM precompile — there is no
centralized API and no Web2 data broker building a profile from your health questions.

> ⚕️ MediCrypt is informational only and is **not** a substitute for professional medical care.
> If you may be having an emergency, contact your local emergency services.

---

## Why Ritual

MediCrypt is impossible to build natively on a normal EVM chain. It leans on Ritual's enshrined
precompiles:

| Capability | How MediCrypt uses it |
|---|---|
| **LLM inference precompile (`0x0802`)** | The `MediCrypt` contract calls the LLM directly, on-chain, to triage symptoms. The model (`zai-org/GLM-4.7-FP8`) runs inside a TEE executor — no off-chain oracle. |
| **Private outputs (ECIES `userPublicKey`)** | The caller generates an **ephemeral keypair** in the browser. Only the public key is sent on-chain; the executor encrypts the triage result to it, so the answer in the event log is ciphertext to everyone but the user. |
| **RitualWallet escrow** | Prepays the async inference fee. |
| **TEEServiceRegistry** | Discovers a live LLM-capable executor at request time instead of hardcoding one. |

The contract **never stores symptom text or the triage answer** — it only keeps anonymous usage
counters (`totalTriages`, per-address `triageCount`).

## Privacy model (honest version)

- ✅ **Output privacy:** triage result is ECIES-encrypted to the user's ephemeral key. The
  ephemeral private key never leaves the browser.
- ✅ **Compute privacy:** inference runs in an attested TEE, not a SaaS API.
- ✅ **No persistence:** no health data in contract storage.
- ⚠️ **Input note:** the symptom text is passed to the precompile as transaction calldata, so the
  *input* is visible on-chain in v1. Encrypting the input (executor-key secret injection, and an
  FHE risk-scoring model) is the documented **v2** hardening — see the roadmap.

## Repository layout

```
MediCrypt/
├── contracts/        # Hardhat project — MediCrypt.sol + deploy/smoke scripts (viem)
├── frontend/         # Next.js app — symptom form, ephemeral keypair, client-side decrypt
├── .env.example      # copy to .env (gitignored) and add your testnet key
└── README.md
```

## Chain

| | |
|---|---|
| Network | Ritual Chain |
| Chain ID | `1979` |
| RPC | `https://rpc.ritualfoundation.org` |
| Explorer | `https://explorer.ritualfoundation.org` |
| Faucet | `https://faucet.ritualfoundation.org` |

## Status

🚧 Active build. See commit history for progress.

## Roadmap

- [ ] v2: encrypt symptom input to the executor (calldata privacy)
- [ ] v2: FHE risk-scoring model (`0x0807`) for a never-decrypted structured score
- [ ] On-chain verified contract source
- [ ] Per-user encrypted triage history

## License

MIT
