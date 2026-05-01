# CT Guard - System Summary

## 1. Problem Statement

Certificate Transparency (CT) relies on browsers verifying that TLS certificates are logged in public, append-only Merkle trees. However, browsers only check that certificates contain valid Signed Certificate Timestamps (SCTs) — they never verify whether the certificate is actually included in a log's tree, nor whether the log presents a consistent view to all observers. An attacker who compromises a CA and CT logs can perform an undetectable MitM attack.

## 2. Threat Model

**Attacker capabilities:**
- Controls at least one CA trusted by the victim's browser
- Controls CT logs satisfying browser SCT requirements (e.g., 2 SCTs from distinct operators)
- Has a MitM position against the client (compromised network, public WiFi, ISP cooperation)

**Attacker limitations:**
- Does not control the victim's device, the legitimate server, or the backend/monitor infrastructure

**Attacker goal:** Perform a MitM attack using a fraudulently issued certificate while keeping it invisible to CT monitors.

## 3. Architecture

The system consists of four components:

```
CT Logs (potentially compromised)
   |              |              |
   v              v              v
Monitor A     Monitor B     Monitor C
(own IP,      (own IP,      (own IP,
 periodic)     periodic)     periodic)
   |              |              |
   +--- push STHs to Backend ---+
                |
         Backend API + DB
                |
         Browser Extension
```

- **Browser Extension** (Firefox, Manifest V2) — intercepts TLS connections, extracts SCTs, performs Proof of Inclusion (PoI) and Proof of Consistency (PoC) verification.
- **Backend** (Express.js + PostgreSQL) — passive STH store. Receives STHs from monitors, serves them to the extension. Never contacts CT logs directly.
- **Monitors** — independent machines running stock certspotter (SSLMate). Indistinguishable from thousands of other certspotter instances. A sidecar process pushes collected STHs to the backend.
- **CT Logs** — existing infrastructure, supporting both RFC 6962 (JSON API) and static-ct/Sunlight (tile-based) protocols.

**Key design principles:**
- Backend never touches CT logs (prevents attacker from identifying backend IP and serving it a clean tree)
- Monitors are indistinguishable from regular CT consumers
- Fail-closed: disruption causes FAIL warnings, not silent MitM

## 4. Verification Flow

1. **TLS Interception** — Extension captures HTTPS requests and extracts the certificate chain.
2. **SCT Extraction** — Parses embedded SCTs from the leaf certificate's X.509v3 extensions.
3. **Proof of Inclusion (PoI)** — For each SCT: computes the Merkle leaf hash, fetches the STH and audit proof from the CT log, and verifies the Merkle audit proof. Catches non-inclusion attacks.
4. **Proof of Consistency (PoC)** — Fetches the monitor-collected STH from the backend. If tree sizes match, compares root hashes directly. If sizes differ, fetches and verifies a consistency proof. Catches split-world attacks.
5. **Decision** — At least one fully verified SCT (PoI + PoC passed) = ALLOW. Zero verified = FAIL.

### Why the Attacker Cannot Forge Consistency Proofs

In a split-world attack, the attacker maintains two divergent Merkle trees: one with the fraudulent cert (shown to the victim) and one without (shown to monitors). It is computationally impossible to produce a valid consistency proof between two trees with different contents — this is the fundamental cryptographic property that CT Guard exploits.

### Known Limitation: Append-Only Split-World

If the attacker freezes the public tree at size N and appends the fraudulent cert to create an attack tree of size N+1, the consistency proof is mathematically valid (the smaller tree is a genuine prefix). This variant is undetectable for active logs but requires the attacker to freeze the log — an operationally conspicuous action. CT Guard detects this variant on readonly logs by performing exact STH comparison instead of consistency proofs.

## 5. Attack Simulation

Three escalating scenarios demonstrate CT Guard's defense layers:

| Scenario | Domain | Attack | Browser | CT Guard |
|---|---|---|---|---|
| 1 | `desmos.com` | Compromised CA, no SCTs | **Blocks** | **FAIL** — no SCTs |
| 2 | `centrum.cz` | + SCTs issued but cert not included in log | Accepts | **FAIL** — PoI fails |
| 3 | `facebook.com` | + cert included in attack tree (split-world) | Accepts | **FAIL** — PoC fails |

Scenario 1 is blocked natively by browsers (Chrome and Firefox v135+ hard-fail certificates without valid SCTs). It is included as a baseline to show the most sophisticated attack browsers can detect on their own. Scenarios 2 and 3 represent the gap that CT Guard fills — attacks that bypass browser-level CT enforcement.

### Simulation Infrastructure

- **DNS Poisoning** — hosts file redirects target domains to attacker's server
- **Compromised CA** — self-signed root CA installed in Firefox's trust store
- **2 Fake CT Logs** — CompactLog (Rust, RFC 6962) running as Docker containers, each with an attack instance and a public instance
- **Split-World Routing** — Caddy reverse proxy routes localhost (monitor) to public instances, external IPs (victim) to attack instances
- **Attacker's HTTPS Server** — Node.js server using SNI to serve the appropriate fraudulent certificate per domain
- **Modified CT Log List** — Google's real log list with the two compromised logs appended

### Defense Stack

```
Layer 1: DNS            → Compromised (attacker controls resolution)
Layer 2: TLS/CA         → Compromised (attacker has CA's private key)
Layer 3: SCT presence   → Browsers block Scenario 1; CT Guard catches independently
Layer 3: SCT signing    → Compromised (attacker has log's private key)
Layer 4: PoI (Merkle)   → CT Guard catches Scenario 2 (non-inclusion)
Layer 5: PoC (Monitor)  → CT Guard catches Scenario 3 (split-world)
```

### Modified Firefox Build

To faithfully simulate real-world browser behavior (where the compromised CA would be publicly-trusted):
- **CertVerifier.cpp** — removed the condition that exempts locally-installed CAs from CT enforcement
- **CTKnownLogs.h** — added the simulation logs' public keys so Firefox recognizes their SCTs

Result: Firefox blocks Scenario 1 (no SCTs) but accepts Scenarios 2 and 3 — confirming the exact gap CT Guard fills.

## 6. Communication Security

| Channel | Protection |
|---|---|
| Extension ↔ Backend | HTTPS (certificate pinning planned — see Future Work) |
| Monitor Sidecar ↔ Backend | Bearer token authentication |
| Extension ↔ CT Logs | HTTPS; all responses cryptographically verified via Merkle proofs |

## 7. Future Work

- **Backend certificate pinning** — most critical vulnerability; attacker with CA + MitM could impersonate backend
- **Monitor IP rotation** — defense-in-depth against long-term monitor identification
- **Static CT (Sunlight) support** — implement tile-based reader for Let's Encrypt logs
- **Additional SCT delivery mechanisms** — TLS extension and OCSP stapling (currently only embedded SCTs supported)
