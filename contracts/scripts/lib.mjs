// Shared helpers for MediCrypt deploy/smoke scripts (viem + Ritual Chain).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, "..", "..");
export const CONTRACTS = join(__dirname, "..");

/** Minimal .env loader (avoids a dotenv dependency). Reads MediCrypt/.env. */
export function loadEnv() {
  const envPath = join(ROOT, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
  // The local AV proxy intercepts TLS; let Node trust it for these dev scripts.
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    // already honored by the runtime if set before first TLS use
  }
}

export const ritualChain = defineChain({
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.RITUAL_RPC_URL || "https://rpc.ritualfoundation.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Ritual Explorer",
      url: "https://explorer.ritualfoundation.org",
    },
  },
});

export function clients() {
  const account = privateKeyToAccount(process.env.PRIVATE_KEY);
  const publicClient = createPublicClient({
    chain: ritualChain,
    transport: http(),
  });
  const walletClient = createWalletClient({
    account,
    chain: ritualChain,
    transport: http(),
  });
  return { account, publicClient, walletClient };
}

export function readArtifact(name = "MediCrypt") {
  const p = join(
    CONTRACTS,
    "artifacts",
    "contracts",
    `${name}.sol`,
    `${name}.json`
  );
  const art = JSON.parse(readFileSync(p, "utf8"));
  return { abi: art.abi, bytecode: art.bytecode };
}

export const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948";
export const TEE_SERVICE_REGISTRY =
  "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F";
export const CAPABILITY_LLM = 1;

const REGISTRY_ABI = [
  {
    name: "getServicesByCapability",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "capability", type: "uint8" },
      { name: "checkValidity", type: "bool" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          {
            name: "node",
            type: "tuple",
            components: [
              { name: "paymentAddress", type: "address" },
              { name: "teeAddress", type: "address" },
              { name: "teeType", type: "uint8" },
              { name: "publicKey", type: "bytes" },
              { name: "endpoint", type: "string" },
              { name: "certPubKeyHash", type: "bytes32" },
              { name: "capability", type: "uint8" },
            ],
          },
          { name: "isValid", type: "bool" },
          { name: "workloadId", type: "bytes32" },
        ],
      },
    ],
  },
];

/** Discover a live LLM-capable executor (address + public key). */
export async function pickLLMExecutor(publicClient) {
  const services = await publicClient.readContract({
    address: TEE_SERVICE_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "getServicesByCapability",
    args: [CAPABILITY_LLM, true],
  });
  const valid = services.filter((s) => s.isValid);
  if (valid.length === 0) {
    throw new Error("No live LLM executors registered on TEEServiceRegistry");
  }
  return {
    address: valid[0].node.teeAddress,
    publicKey: valid[0].node.publicKey,
    count: valid.length,
  };
}

/** Claim testnet RITUAL from the faucet. The live faucet requires an access code
 *  (set FAUCET_ACCESS_CODE in .env, obtained from the Ritual faucet site/Discord). */
export async function claimFaucet(address) {
  const code = process.env.FAUCET_ACCESS_CODE;
  if (!code) {
    return {
      ok: false,
      status: 0,
      body: "No FAUCET_ACCESS_CODE set — claim manually at https://faucet.ritualfoundation.org",
    };
  }
  const res = await fetch("https://faucet.ritualfoundation.org/api/drip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, accessCode: code, code }),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text };
}

export const RITUAL_WALLET_ABI = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "lockDuration", type: "uint256" }],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
];
