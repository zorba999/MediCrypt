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

/** Unwrap one ABI `(bytes, bytes)` layer, returning the first element (or null). */
function firstBytes(hex: Hex): Hex | null {
  try {
    const [a] = decodeAbiParameters(parseAbiParameters("bytes, bytes"), hex);
    return a as Hex;
  } catch {
    return null;
  }
}

/** Second element of an ABI `(bytes, bytes)` (or null). */
function secondBytes(hex: Hex): Hex | null {
  try {
    const [, b] = decodeAbiParameters(parseAbiParameters("bytes, bytes"), hex);
    return b as Hex;
  } catch {
    return null;
  }
}

/**
 * Turn the on-chain raw precompile result into a Triage.
 *
 * Encrypted layout (the live path):
 *   result   = (bytes simmedInput, bytes actualOutput)
 *   actualOutput = (bytes encryptedCompletion, bytes metadata)
 *   encryptedCompletion = ECIES blob -> decrypt with the ephemeral key (nonce len 12)
 *   decrypted = ABI completion bytes whose text contains the triage JSON.
 */
export function decodeTriageResult(
  resultHex: Hex,
  ephemeralPrivateKey: string
): { triage: Triage; wasEncrypted: boolean } {
  const actualOutput = secondBytes(resultHex) ?? resultHex;

  // Private path: decrypt the encrypted completion blob.
  const encBlob = firstBytes(actualOutput);
  if (encBlob) {
    try {
      const decrypted = decrypt(ephemeralPrivateKey, hexToBytes(encBlob));
      const text = new TextDecoder().decode(decrypted);
      return { triage: extractJson(text), wasEncrypted: true };
    } catch {
      /* fall through to plaintext */
    }
  }

  // Fallback: plaintext completion envelope (no output encryption).
  const content = decodeCompletionContent(actualOutput);
  if (content) return { triage: extractJson(content), wasEncrypted: false };

  return { triage: { raw: "Could not decode the triage result." }, wasEncrypted: false };
}
