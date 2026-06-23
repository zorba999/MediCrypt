// Deploy MediCrypt to Ritual Chain. Funds the deployer from the faucet if needed,
// deposits into RitualWallet for inference fees, deploys the contract, and writes the
// address to deployments/medicrypt.json + frontend/.env.local.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { formatEther, parseEther } from "viem";
import {
  loadEnv,
  clients,
  readArtifact,
  pickLLMExecutor,
  claimFaucet,
  ROOT,
  RITUAL_WALLET,
  RITUAL_WALLET_ABI,
} from "./lib.mjs";

loadEnv();

const { account, publicClient, walletClient } = clients();
console.log("Deployer:", account.address);

// 1. Ensure the deployer has gas; claim from faucet if low.
let bal = await publicClient.getBalance({ address: account.address });
console.log("Balance:", formatEther(bal), "RITUAL");
if (bal < parseEther("0.5")) {
  console.log("Low balance — claiming faucet...");
  const f = await claimFaucet(account.address);
  console.log("Faucet:", f.status, f.body.slice(0, 200));
  for (let i = 0; i < 30 && bal < parseEther("0.5"); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    bal = await publicClient.getBalance({ address: account.address });
  }
  console.log("Balance now:", formatEther(bal), "RITUAL");
}

// 2. Confirm a live LLM executor exists (fail fast before deploying).
const exec = await pickLLMExecutor(publicClient);
console.log(`LLM executors: ${exec.count} live. Using ${exec.address}`);

// 3. Deploy MediCrypt.
const { abi, bytecode } = readArtifact("MediCrypt");
console.log("Deploying MediCrypt...");
const hash = await walletClient.deployContract({ abi, bytecode, args: [] });
console.log("Deploy tx:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const address = receipt.contractAddress;
console.log("MediCrypt deployed at:", address);

// 4. Pre-fund RitualWallet escrow so the first triage call can settle.
//    Deposit what we can afford (keep a gas reserve). Inference needs ~0.4 RIT escrow,
//    so warn if we end up short.
bal = await publicClient.getBalance({ address: account.address });
const reserve = parseEther("0.02");
const depositAmount = bal > reserve ? bal - reserve : 0n;
if (depositAmount > 0n) {
  console.log(`Depositing ${formatEther(depositAmount)} RITUAL into RitualWallet...`);
  const depHash = await walletClient.writeContract({
    address: RITUAL_WALLET,
    abi: RITUAL_WALLET_ABI,
    functionName: "deposit",
    args: [5000n],
    value: depositAmount,
  });
  await publicClient.waitForTransactionReceipt({ hash: depHash });
}
const walletBal = await publicClient.readContract({
  address: RITUAL_WALLET,
  abi: RITUAL_WALLET_ABI,
  functionName: "balanceOf",
  args: [account.address],
});
console.log("RitualWallet escrow:", formatEther(walletBal), "RITUAL");
if (walletBal < parseEther("0.4")) {
  console.warn(
    "⚠️  Escrow < 0.4 RITUAL — a live inference call may revert. Top up the deployer at https://faucet.ritualfoundation.org and re-run."
  );
}

// 5. Persist deployment info (non-secret) for the frontend.
const out = {
  network: "ritual",
  chainId: 1979,
  address,
  deployTx: hash,
  deployer: account.address,
  llmExecutor: exec.address,
  deployedAt: new Date().toISOString(),
};
mkdirSync(join(ROOT, "deployments"), { recursive: true });
writeFileSync(
  join(ROOT, "deployments", "medicrypt.json"),
  JSON.stringify(out, null, 2) + "\n"
);

mkdirSync(join(ROOT, "frontend"), { recursive: true });
writeFileSync(
  join(ROOT, "frontend", ".env.local"),
  [
    `NEXT_PUBLIC_MEDICRYPT_ADDRESS=${address}`,
    `NEXT_PUBLIC_LLM_EXECUTOR=${exec.address}`,
    `NEXT_PUBLIC_RITUAL_RPC_URL=https://rpc.ritualfoundation.org`,
    "",
  ].join("\n")
);

console.log("\nDone. Wrote deployments/medicrypt.json and frontend/.env.local");
