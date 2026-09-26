# Rust WASM Decision Record

**Date:** 2026-09-24
**Status:** Rejected (ToT-2 verdict)
**Confidence:** 88 (SYNTHESIS)
**Related Task:** rgbf51-20260924-001

---

## ToT-2 Verdict Summary

The Tree of Thoughts evaluation (ToT-2) rejected the Rust WASM layer for client-side encryption. The synthesis concluded with **88% confidence** that WebCrypto API alone is the correct choice for v1.0.

### Key Reasons for Rejection

| Factor | Assessment |
|--------|------------|
| **CSP Regression** | WASM requires `script-src 'wasm-unsafe-eval'` or similar, weakening Content Security Policy. This expands the attack surface for XSS exploitation. |
| **Zero Threat-Model Gain** | The threat model assumes a malicious script already running in the page context. WASM memory is readable by JavaScript (`new Uint8Array(wasmModule.exports.memory.buffer)`), providing no additional protection against the assumed threat. |
| **Review Friction** | Rust toolchain (wasm-pack, cargo, nightly toolchain) adds CI complexity, increases PR review burden, and requires specialized security review for memory-safety assumptions that don't hold in the browser threat model. |

---

## WebCrypto Seam for Future Swap

The encryption interface is designed as a thin, swappable seam. Should a future requirement justify WASM (see *Revisit Triggers*), only this module changes.

### Interface (TypeScript)

```typescript
// src/crypto/seam.ts
export interface CryptoSeam {
  encrypt(plaintext: Uint8Array, key: CryptoKey): Promise<Uint8Array>;
  decrypt(ciphertext: Uint8Array, key: CryptoKey): Promise<Uint8Array>;
  deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey>;
  generateKey(): Promise<CryptoKey>;
  exportKey(key: CryptoKey): Promise<JsonWebKey>;
  importKey(jwk: JsonWebKey): Promise<CryptoKey>;
}
```

### Current Implementation

- **Algorithm:** AES-GCM (WebCrypto native)
- **Key Derivation:** PBKDF2 (100,000 iterations, SHA-256)
- **Session Cache:** Key cached in memory for session duration (avoids repeated passphrase entry)
- **PII Handling:** Plaintext in memory during active session; no disk persistence

### Swap Procedure

1. Implement `CryptoSeam` in Rust, compile to WASM
2. Replace `src/crypto/seam.ts` with a thin wrapper calling WASM exports
3. Update CSP to allow `wasm-unsafe-eval` (documented exception)
4. Run full security review (WASM memory exposure, side-channel analysis)
5. Update this decision record with new verdict

---

## Revisit Triggers

This decision **will be revisited** if **either** condition occurs:

### Trigger 1: Malicious Dependency Incident
**Condition:** A supply-chain compromise in the JavaScript dependency tree (npm/yarn/pnpm) results in credential exfiltration or PII theft in a production deployment using WebCrypto.
**Evidence Required:** Post-mortem showing WebCrypto key material was accessible to the malicious script *and* WASM would have materially raised the bar (e.g., key never exposed to JS heap).
**Action:** Re-open ToT evaluation with incident data; target confidence threshold 90+.

### Trigger 2: Zero-Disk-Footprint Requirement
**Condition:** A regulatory or customer mandate requires that **no encryption key material ever touches the JavaScript heap**, including transiently during `encrypt()`/`decrypt()` calls.
**Evidence Required:** Formal requirement document (GDPR Art. 32, SOC 2 CC6.1, or customer contract clause) citing "keys must not exist in JS-accessible memory."
**Action:** Prototype WASM key isolation (keys generated/stored in WASM linear memory, never exported); benchmark performance and CSP impact; re-evaluate.

---

## Non-Triggers (Explicitly Not Revisit Conditions)

- Performance concerns (WebCrypto is hardware-accelerated)
- Developer preference for Rust
- "Defense in depth" arguments without threat-model alignment
- Speculative future threats not in current MITRE ATT&CK mapping

---

## Audit Trail

| Date | Author | Change |
|------|--------|--------|
| 2026-09-24 | ToT-2 Synthesis | Initial decision recorded |

---

## References

- [Decisions Log](../.opencode/memory/decisions.md) — Row 2 (Client encryption)
- [Security Review](../docs/security-review.md) — Threat model section
- [CSP Configuration](../server/app/middleware/csp.py) — Current policy