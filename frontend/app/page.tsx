"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useConnect,
  useChainId,
  useSwitchChain,
  usePublicClient,
  useWalletClient,
  useReadContract,
} from "wagmi";
import { decodeEventLog, parseEther, formatEther, type Hex } from "viem";
import { ritualChain } from "@/lib/chain";
import {
  MEDICRYPT_ADDRESS,
  MEDICRYPT_ABI,
  LLM_EXECUTOR,
  RITUAL_WALLET,
  RITUAL_WALLET_ABI,
} from "@/lib/medicrypt";
import {
  generateEphemeralKey,
  decodeTriageResult,
  type Triage,
} from "@/lib/triage";

type Phase =
  | "idle"
  | "funding"
  | "submitting"
  | "waiting"
  | "decrypting"
  | "done"
  | "error";

const RISK_CLASS: Record<string, string> = {
  low: "risk-low",
  medium: "risk-medium",
  high: "risk-high",
  emergency: "risk-emergency",
};

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "🤧 Cold / flu",
    text: "Sore throat and a mild fever (37.9°C) for two days, plus a runny nose and a light cough. No trouble breathing.",
  },
  {
    label: "🤕 Headache",
    text: "A throbbing headache on one side for the last 6 hours, a bit of nausea, and light feels uncomfortable. No fever.",
  },
  {
    label: "🤢 Stomach upset",
    text: "Stomach cramps and diarrhea since this morning after eating out, with some nausea but no blood and no high fever.",
  },
  {
    label: "🫁 Chest pain",
    text: "Tight pressure in the center of my chest for about 20 minutes, spreading to my left arm, with shortness of breath and sweating.",
  },
  {
    label: "🤚 Skin rash",
    text: "An itchy red rash on both forearms that appeared yesterday after gardening. No swelling of the face or throat, breathing is fine.",
  },
];

export default function Home() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [symptoms, setSymptoms] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [triage, setTriage] = useState<Triage | null>(null);
  const [encrypted, setEncrypted] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const { data: total } = useReadContract({
    address: MEDICRYPT_ADDRESS,
    abi: MEDICRYPT_ABI,
    functionName: "totalTriages",
  });

  const wrongChain = isConnected && chainId !== ritualChain.id;
  const busy = ["funding", "submitting", "waiting", "decrypting"].includes(phase);

  // Once connected, make sure the wallet is on Ritual Chain — prompts MetaMask to add it
  // (wallet_addEthereumChain) the first time, since it isn't a default network.
  useEffect(() => {
    if (isConnected && chainId !== ritualChain.id) {
      switchChain({ chainId: ritualChain.id });
    }
  }, [isConnected, chainId, switchChain]);

  function connectWallet() {
    connect({ connector: connectors[0], chainId: ritualChain.id });
  }

  async function ensureEscrow() {
    if (!walletClient || !address || !publicClient) return;
    const bal = (await publicClient.readContract({
      address: RITUAL_WALLET,
      abi: RITUAL_WALLET_ABI,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
    if (bal >= parseEther("0.4")) return;
    setPhase("funding");
    const hash = await walletClient.writeContract({
      address: RITUAL_WALLET,
      abi: RITUAL_WALLET_ABI,
      functionName: "deposit",
      args: [5000n],
      value: parseEther("0.5"),
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  async function onTriage() {
    setError("");
    setTriage(null);
    setTxHash(null);
    if (!walletClient || !address || !publicClient) {
      setError("Connect your wallet first.");
      return;
    }
    if (!symptoms.trim()) {
      setError("Describe your symptoms first.");
      return;
    }
    try {
      await ensureEscrow();

      // Ephemeral keypair — the private key never leaves this browser tab.
      const eph = generateEphemeralKey();

      setPhase("submitting");
      const hash = await walletClient.writeContract({
        address: MEDICRYPT_ADDRESS,
        abi: MEDICRYPT_ABI,
        functionName: "requestTriage",
        args: [LLM_EXECUTOR, symptoms.trim(), eph.publicKey],
        gas: 6_000_000n,
      });
      setTxHash(hash);

      setPhase("waiting");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });

      setPhase("decrypting");
      let resultHex: Hex | null = null;
      let hadError = false;
      for (const log of receipt.logs) {
        try {
          const ev = decodeEventLog({
            abi: MEDICRYPT_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (ev.eventName === "TriageCompleted") {
            hadError = ev.args.hasError as boolean;
            resultHex = ev.args.encryptedResult as Hex;
          }
        } catch {
          /* not our event */
        }
      }

      if (hadError || !resultHex || resultHex === "0x") {
        throw new Error(
          "The model could not complete the triage. Please try again."
        );
      }

      const { triage: t, wasEncrypted } = decodeTriageResult(
        resultHex,
        eph.privateKey
      );
      setTriage(t);
      setEncrypted(wasEncrypted);
      setPhase("done");
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Something went wrong.");
      setPhase("error");
    }
  }

  const riskKey = (triage?.risk_level || "").toLowerCase();

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <span className="dot">🔐</span> MediCrypt
        </div>
        {isConnected ? (
          <span className="pill">
            ● {address!.slice(0, 6)}…{address!.slice(-4)}
          </span>
        ) : (
          <button
            className="btn-ghost"
            onClick={connectWallet}
          >
            Connect wallet
          </button>
        )}
      </div>

      <div className="hero">
        <h1>
          Private AI symptom triage,
          <br />
          <span className="grad">encrypted to you alone.</span>
        </h1>
        <p>
          Describe how you feel. An AI running inside Ritual&apos;s secure enclave
          gives you a triage — and the answer is encrypted so only your browser
          can read it. No clinic, no data broker, no profile.
        </p>
        <div className="stats">
          <span>Contract: {MEDICRYPT_ADDRESS.slice(0, 8)}…</span>
          <span>· Triages served: {total?.toString() ?? "—"}</span>
        </div>
      </div>

      {wrongChain && (
        <div className="card">
          <div className="status">You&apos;re on the wrong network.</div>
          <div className="row">
            <button
              className="btn-primary"
              onClick={() => switchChain({ chainId: ritualChain.id })}
            >
              Switch to Ritual Chain
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Your symptoms</h2>
        <textarea
          placeholder="e.g. Sore throat and mild fever for two days, plus a runny nose. No trouble breathing."
          value={symptoms}
          onChange={(e) => setSymptoms(e.target.value)}
          disabled={busy}
        />

        <div className="examples">
          <span className="examples-label">Try an example:</span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              className="chip"
              onClick={() => setSymptoms(ex.text)}
              disabled={busy}
            >
              {ex.label}
            </button>
          ))}
        </div>

        <div className="row">
          <button
            className="btn-primary"
            onClick={onTriage}
            disabled={busy || !isConnected || wrongChain}
          >
            {busy ? "Working…" : "Get private triage"}
          </button>
          {!isConnected && (
            <button
              className="btn-ghost"
              onClick={connectWallet}
            >
              Connect wallet
            </button>
          )}
        </div>

        <div className="privacy-note">
          <span>🔑</span>
          <span>
            A one-time encryption key is generated in your browser. Only its
            public half is sent on-chain; the triage comes back encrypted to it,
            so no one else — not even the node — can read your result.
          </span>
        </div>

        {phase === "funding" && (
          <div className="status">
            <span className="spinner" /> Funding inference escrow (one-time
            deposit)…
          </div>
        )}
        {phase === "submitting" && (
          <div className="status">
            <span className="spinner" /> Sending your encrypted request…
          </div>
        )}
        {phase === "waiting" && (
          <div className="status">
            <span className="spinner" /> Running AI inference inside the TEE…
          </div>
        )}
        {phase === "decrypting" && (
          <div className="status">
            <span className="spinner" /> Decrypting your result locally…
          </div>
        )}
        {error && <div className="error">⚠ {error}</div>}
      </div>

      {triage && phase === "done" && (
        <div className="card result">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>Your triage</h3>
            {riskKey && (
              <span className={`risk ${RISK_CLASS[riskKey] || ""}`}>
                {triage.risk_level}
              </span>
            )}
          </div>

          {triage.summary && <p style={{ lineHeight: 1.6 }}>{triage.summary}</p>}

          {triage.advice && triage.advice.length > 0 && (
            <ul className="advice">
              {triage.advice.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}

          {typeof triage.see_doctor === "boolean" && (
            <p className="status">
              {triage.see_doctor
                ? "👩‍⚕️ Seeing a doctor is recommended."
                : "🟢 Self-care is likely reasonable for now."}
            </p>
          )}

          {triage.raw && <p style={{ lineHeight: 1.6 }}>{triage.raw}</p>}

          <p className="disclaimer">
            {triage.disclaimer ||
              "This is informational only and not a substitute for professional medical care."}
          </p>

          <div className="stats">
            <span>{encrypted ? "🔒 Decrypted locally" : "⚠ Plaintext result"}</span>
            {txHash && (
              <a
                href={`https://explorer.ritualfoundation.org/tx/${txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction ↗
              </a>
            )}
          </div>
        </div>
      )}

      <div className="foot">
        Built on Ritual Chain · LLM precompile 0x0802 · ECIES private outputs
        <br />
        MediCrypt is a demo. In an emergency, contact local emergency services.
      </div>
    </div>
  );
}
