// Live end-to-end smoke test of a deployed MediCrypt contract.
// Generates an ephemeral ECIES keypair, requests a triage, then proves that the emitted
// result can be decrypted ONLY with the ephemeral private key (the privacy guarantee).
//
// Requires the deployer to hold enough RitualWallet escrow (~0.4 RITUAL). Run:
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node scripts/smoke.mjs
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { decodeEventLog, hexToBytes } from "viem";
import { PrivateKey, decrypt, ECIES_CONFIG } from "eciesjs";
import { loadEnv, clients, readArtifact, ROOT } from "./lib.mjs";

ECIES_CONFIG.symmetricNonceLength = 12; // mandatory for Ritual ECIES payloads

loadEnv();
const { account, publicClient, walletClient } = clients();
const { abi } = readArtifact("MediCrypt");

const deployment = JSON.parse(
  readFileSync(join(ROOT, "deployments", "medicrypt.json"), "utf8")
);
const CONTRACT = deployment.address;
const EXECUTOR = deployment.llmExecutor;

const SYMPTOMS =
  "I've had a sore throat and mild fever (37.9C) for two days, plus a runny nose. No trouble breathing.";

// 1. Ephemeral keypair — the private key never leaves this process (the browser, in prod).
const sk = new PrivateKey();
const userPublicKey = `0x${sk.publicKey.toHex(false)}`; // uncompressed SEC1 (65 bytes, 0x04)
const userPrivateKey = sk.toHex();
console.log("Ephemeral pubkey:", userPublicKey.slice(0, 26) + "...");

// 2. Send the triage request.
console.log("Requesting triage from", CONTRACT, "...");
const hash = await walletClient.writeContract({
  address: CONTRACT,
  abi,
  functionName: "requestTriage",
  args: [EXECUTOR, SYMPTOMS, userPublicKey],
  gas: 6_000_000n,
});
console.log("tx:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("status:", receipt.status);

// 3. Find the TriageCompleted event and pull the (encrypted) result bytes.
let result;
for (const log of receipt.logs) {
  try {
    const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
    if (ev.eventName === "TriageCompleted") {
      console.log("hasError:", ev.args.hasError);
      result = ev.args.encryptedResult;
    }
  } catch {}
}
if (!result || result === "0x") {
  console.log("No result bytes emitted (inference may have errored). Check escrow + executor.");
  process.exit(1);
}
console.log("result bytes length:", (result.length - 2) / 2);

// 4. Prove privacy: only the ephemeral key can read it.
try {
  const plain = decrypt(userPrivateKey, Buffer.from(hexToBytes(result))).toString("utf8");
  console.log("\n✅ Decrypted triage (only the holder of the ephemeral key can do this):\n");
  console.log(plain);
} catch (e) {
  console.log(
    "\nCould not ECIES-decrypt the result — output may not be encrypted at this layer."
  );
  console.log("Raw (hex, first 160 chars):", result.slice(0, 160));
  console.log("Decrypt error:", e.message);
}
