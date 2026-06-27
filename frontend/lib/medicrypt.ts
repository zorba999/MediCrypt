import type { Address } from "viem";

export const MEDICRYPT_ADDRESS = (process.env.NEXT_PUBLIC_MEDICRYPT_ADDRESS ||
  "0xada7f720ae1a2b3c58ee1e7f7ed95467c725f708") as Address;

export const LLM_EXECUTOR = (process.env.NEXT_PUBLIC_LLM_EXECUTOR ||
  "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B") as Address;

export const RITUAL_WALLET =
  "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948" as Address;

export const MEDICRYPT_ABI = [
  {
    type: "function",
    name: "requestTriage",
    stateMutability: "nonpayable",
    inputs: [
      { name: "executor", type: "address" },
      { name: "symptoms", type: "string" },
      { name: "userPublicKey", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "totalTriages",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "triageCount",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "TriageCompleted",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "index", type: "uint256", indexed: true },
      { name: "hasError", type: "bool", indexed: false },
      { name: "encryptedResult", type: "bytes", indexed: false },
    ],
  },
] as const;

export const RITUAL_WALLET_ABI = [
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [{ name: "lockDuration", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
