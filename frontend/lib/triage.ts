import { decodeAbiParameters, parseAbiParameters, hexToBytes, type Hex } from "viem";
import { PrivateKey, decrypt, ECIES_CONFIG } from "eciesjs";

ECIES_CONFIG.symmetricNonceLength = 12; // mandatory for Ritual ECIES payloads

export interface EphemeralKey {
  publicKey: Hex;
  privateKey: string;
}

/** Generate a one-time keypair. The private key stays in memory in the browser only.
 *  The Ritual LLM precompile requires an UNCOMPRESSED SEC1 public key (65 bytes, 0x04). */
export function generateEphemeralKey(): EphemeralKey {
  const sk = new PrivateKey();
  return {
    publicKey: `0x${sk.publicKey.toHex(false)}` as Hex, // false = uncompressed
    privateKey: sk.toHex(),
  };
}

export interface Triage {
  risk_level?: "low" | "medium" | "high" | "emergency" | string;
  summary?: string;
  advice?: string[];
  see_doctor?: boolean;
  disclaimer?: string;
  raw?: string;
}

/** Pull a JSON object out of model text that may be wrapped in prose or ```json fences. */
function extractJson(text: string): Triage {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as Triage;
    } catch {
      /* fall through */
    }
  }
  return { raw: text.trim() };
}

/** ABI-decode a plaintext LLM completion envelope and return the message content. */
function decodeCompletionContent(hex: Hex): string | null {
  try {
    const [, , , , , , choicesCount, choicesData] = decodeAbiParameters(
      parseAbiParameters(
        "string, string, uint256, string, string, string, uint256, bytes[], bytes"
      ),
      hex
    );
    if (choicesCount === 0n || choicesData.length === 0) return null;
    const [, , messageData] = decodeAbiParameters(
      parseAbiParameters("uint256, string, bytes"),
      choicesData[0] as Hex
    );
    const [, content] = decodeAbiParameters(
      parseAbiParameters("string, string, string, uint256, bytes[]"),
      messageData as Hex
    );
    return content as string;
  } catch {
    return null;
  }
}

/**
 * Turn the on-chain `encryptedResult` bytes into a Triage.
 * Tries ECIES decryption first (private output), then falls back to decoding a
 * plaintext completion envelope.
 */
export function decodeTriageResult(
  resultHex: Hex,
  ephemeralPrivateKey: string
): { triage: Triage; wasEncrypted: boolean } {
  // Path A: private output encrypted to the ephemeral key.
  try {
    const decrypted = decrypt(ephemeralPrivateKey, hexToBytes(resultHex));
    const plain = new TextDecoder().decode(decrypted);
    return { triage: extractJson(plain), wasEncrypted: true };
  } catch {
    /* not encrypted at this layer — try plaintext ABI */
  }

  // Path B: plaintext completion envelope.
  const content = decodeCompletionContent(resultHex);
  if (content) return { triage: extractJson(content), wasEncrypted: false };

  return { triage: { raw: "Could not decode the triage result." }, wasEncrypted: false };
}
