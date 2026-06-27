"use client";

import { useState, useEffect, useRef } from "react";
import {
  useAccount,
  useConnect,
  useSwitchChain,
  usePublicClient,
  useWalletClient,
  useReadContract,
} from "wagmi";
import { parseEther, type Hex } from "viem";
import gsap from "gsap";
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
import { ThemeToggle } from "@/components/ThemeToggle";
import { ScrambleText } from "@/components/ScrambleText";

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
  { label: "🤧 Cold / flu", text: "Sore throat and a mild fever (37.9°C) for two days, plus a runny nose and a light cough. No trouble breathing." },
  { label: "🤕 Headache", text: "A throbbing headache on one side for the last 6 hours, a bit of nausea, and light feels uncomfortable. No fever." },
  { label: "🤢 Stomach upset", text: "Stomach cramps and diarrhea since this morning after eating out, with some nausea but no blood and no high fever." },
  { label: "🫁 Chest pain", text: "Tight pressure in the center of my chest for about 20 minutes, spreading to my left arm, with shortness of breath and sweating." },
  { label: "🤚 Skin rash", text: "An itchy red rash on both forearms that appeared yesterday after gardening. No facial or throat swelling, breathing is fine." },
];

const STEPS = [
  { key: "connect", label: "Wallet connected" },
  { key: "fund", label: "Inference escrow ready" },
  { key: "submit", label: "Encrypted request sent" },
  { key: "think", label: "AI reasoning inside the TEE" },
  { key: "decrypt", label: "Decrypting locally" },
];

function phaseStepIndex(phase: Phase, connected: boolean): number {
  switch (phase) {
    case "funding": return 1;
    case "submitting": return 2;
    case "waiting": return 3;
    case "decrypting": return 4;
    case "done": return 5;
    default: return connected ? 1 : 0;
  }
}

export default function Home() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [symptoms, setSymptoms] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [triage, setTriage] = useState<Triage | null>(null);
  const [encrypted, setEncrypted] = useState(false);
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [revealAdvice, setRevealAdvice] = useState(false);

  const heroRef = useRef<HTMLDivElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const adviceRef = useRef<HTMLUListElement>(null);

  const { data: total } = useReadContract({
    address: MEDICRYPT_ADDRESS,
    abi: MEDICRYPT_ABI,
    functionName: "totalTriages",
  });

  const onRitual = chainId === ritualChain.id;
  const wrongChain = isConnected && !onRitual;
  const busy = ["funding", "submitting", "waiting", "decrypting"].includes(phase);
  const showPipeline = busy || phase === "done";
  const activeStep = phaseStepIndex(phase, isConnected);

  // Hero + console entrance.
  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      tl.from(".eyebrow", { y: 16, opacity: 0, duration: 0.6 })
        .from(".hero .word", { y: 40, opacity: 0, duration: 0.7, stagger: 0.06 }, "-=0.2")
        .from(".hero .lede", { y: 20, opacity: 0, duration: 0.6 }, "-=0.35")
        .from(".meta-strip .tag", { y: 14, opacity: 0, duration: 0.5, stagger: 0.07 }, "-=0.3")
        .from(consoleRef.current, { y: 40, opacity: 0, duration: 0.8 }, "-=0.4");
    });
    return () => ctx.revert();
  }, []);

  // Auto-switch to Ritual once connected.
  useEffect(() => {
    if (isConnected && chainId !== ritualChain.id) {
      switchChain({ chainId: ritualChain.id });
    }
  }, [isConnected, chainId, switchChain]);

  // Animate the result card in.
  useEffect(() => {
    if (phase === "done" && resultRef.current) {
      gsap.from(resultRef.current, { y: 30, opacity: 0, duration: 0.7, ease: "power3.out" });
    }
  }, [phase]);

  // Stagger advice lines after the scramble resolves.
  useEffect(() => {
    if (revealAdvice && adviceRef.current) {
      gsap.from(adviceRef.current.children, {
        x: -14, opacity: 0, duration: 0.5, stagger: 0.08, ease: "power2.out",
      });
    }
  }, [revealAdvice]);

  function connectWallet() {
    connect({ connector: connectors[0], chainId: ritualChain.id });
  }

  // Async-precompile txs can't be gas-estimated by the wallet, so we supply explicit
  // EIP-1559 fees + gas. Without these, wallets show "Network fee --" and disable Confirm.
  // Ritual gas is ~1 gwei with a near-zero base fee; use the network estimate directly so
  // wallets show a tiny network fee instead of an inflated max.
  async function getFees() {
    try {
      const f = await publicClient!.estimateFeesPerGas();
      return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    } catch {
      return { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
    }
  }

  // The inference fee is escrowed in RitualWallet, and the async call REQUIRES the escrow to
  // stay locked past the settlement block. Too short → the RPC rejects with "insufficient lock
  // duration"; too long → the worst-case (~0.31 RIT) reservation per call doesn't refund and
  // the balance starves after a couple calls. 5000 blocks (~29 min) is the right balance.
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
    const fees = await getFees();
    const hash = await walletClient.writeContract({
      address: RITUAL_WALLET,
      abi: RITUAL_WALLET_ABI,
      functionName: "deposit",
      args: [5000n],
      value: parseEther("0.5"),
      gas: 200_000n,
      ...fees,
    });
    await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  }

  async function onTriage() {
    setError("");
    setTriage(null);
    setTxHash(null);
    setRevealAdvice(false);
    if (!isConnected || !address) {
      setError("Connect your wallet first.");
      return;
    }
    if (wrongChain) {
      setError("Switching your wallet to Ritual Chain…");
      switchChain({ chainId: ritualChain.id });
      return;
    }
    if (!walletClient || !publicClient) {
      setError("Wallet is still initializing — try again in a moment.");
      return;
    }
    if (!symptoms.trim()) {
      setError("Describe your symptoms first.");
      return;
    }
    try {
      await ensureEscrow();

      // Ritual's testnet has a single LLM executor that intermittently drops requests (the
      // builder skips them silently — no settlement, no event, and the tx isn't even mined, so
      // a retry costs nothing). We resubmit a few times until one settles. Each attempt uses a
      // fresh ephemeral key, so we keep them all and decrypt the result with whichever matches.
      const fromBlock = await publicClient.getBlockNumber();
      const keys: string[] = [];
      const triageReqBase = {
        address: MEDICRYPT_ADDRESS,
        abi: MEDICRYPT_ABI,
        functionName: "requestTriage" as const,
        gas: 6_000_000n,
      };

      let resultHex: Hex | null = null;
      let hadError = false;
      const MAX_ATTEMPTS = 4;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !resultHex; attempt++) {
        const eph = generateEphemeralKey();
        keys.push(eph.privateKey);
        const req = {
          ...triageReqBase,
          args: [LLM_EXECUTOR, symptoms.trim(), eph.publicKey] as const,
        };

        setPhase("submitting");
        let hash: Hex;
        try {
          hash = await walletClient.writeContract({ ...req, ...(await getFees()) });
        } catch (e: any) {
          const msg = (e?.details || e?.shortMessage || e?.message || "").toLowerCase();
          if (!msg.includes("lock")) throw e;
          // Escrow lock expired — renew it and resubmit this attempt.
          setPhase("funding");
          const dh = await walletClient.writeContract({
            address: RITUAL_WALLET,
            abi: RITUAL_WALLET_ABI,
            functionName: "deposit",
            args: [5000n],
            value: parseEther("0.5"),
            gas: 200_000n,
            ...(await getFees()),
          });
          await publicClient.waitForTransactionReceipt({ hash: dh, timeout: 120_000 });
          setPhase("submitting");
          hash = await walletClient.writeContract({ ...req, ...(await getFees()) });
        }
        setTxHash(hash);

        // Wait up to ~55s for THIS attempt to settle; otherwise resubmit.
        setPhase("waiting");
        const deadline = Date.now() + 55_000;
        while (Date.now() < deadline && !resultHex) {
          await new Promise((r) => setTimeout(r, 3000));
          const logs = await publicClient.getContractEvents({
            address: MEDICRYPT_ADDRESS,
            abi: MEDICRYPT_ABI,
            eventName: "TriageCompleted",
            fromBlock,
            toBlock: "latest",
          });
          const mine = logs.filter(
            (l) => (l.args.user as string)?.toLowerCase() === address.toLowerCase()
          );
          if (mine.length) {
            const ev = mine[mine.length - 1];
            hadError = ev.args.hasError as boolean;
            resultHex = ev.args.encryptedResult as Hex;
          }
        }
      }

      setPhase("decrypting");
      if (!resultHex || resultHex === "0x") {
        throw new Error(
          "The testnet TEE executor is busy and dropped the request several times. Please click Get private triage again."
        );
      }
      if (hadError) {
        throw new Error("The model returned an error. Please try again.");
      }

      // Decrypt with whichever ephemeral key matches (events may settle out of order).
      let decoded = decodeTriageResult(resultHex, keys[keys.length - 1]);
      if (decoded.triage.raw && keys.length > 1) {
        for (const k of keys) {
          const d = decodeTriageResult(resultHex, k);
          if (!d.triage.raw) {
            decoded = d;
            break;
          }
        }
      }
      setTriage(decoded.triage);
      setEncrypted(decoded.wasEncrypted);
      setPhase("done");
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || "Something went wrong.");
      setPhase("error");
    }
  }

  const riskKey = (triage?.risk_level || "").toLowerCase();
  const summaryText = triage?.summary || triage?.raw || "";

  return (
    <>
      <div className="bg-aura" aria-hidden />
      <div className="bg-grid" aria-hidden />

      <div className="wrap">
        <div className="topbar">
          <div className="brand">
            <span className="mark"><span>🔐</span></span> MediCrypt
          </div>
          <div className="topbar-right">
            <ThemeToggle />
            {isConnected ? (
              <span className="addr-pill">
                <span className="dot" /> {address!.slice(0, 6)}…{address!.slice(-4)}
              </span>
            ) : (
              <button className="btn-ghost" onClick={connectWallet}>Connect wallet</button>
            )}
          </div>
        </div>

        <div className="hero" ref={heroRef}>
          <span className="eyebrow"><span className="live" /> Ritual Chain · enclave-private AI</span>
          <h1>
            <span className="word">Private</span>{" "}
            <span className="word">AI</span>{" "}
            <span className="word">symptom</span>{" "}
            <span className="word">triage,</span>
            <br />
            <span className="grad">
              <span className="word">encrypted</span>{" "}
              <span className="word">to</span>{" "}
              <span className="word">you</span>{" "}
              <span className="word">alone.</span>
            </span>
          </h1>
          <p className="lede">
            Describe how you feel. An AI running inside Ritual&apos;s secure enclave
            returns a triage — and the answer is sealed with a key only your browser
            holds. No clinic, no data broker, no profile.
          </p>
          <div className="meta-strip">
            <span className="tag">⛓ chain 1979</span>
            <span className="tag">◷ ~350ms blocks</span>
            <span className="tag">🔑 ECIES private output</span>
            <span className="tag">△ triages: {total?.toString() ?? "—"}</span>
          </div>
        </div>

        {wrongChain && (
          <div className="card">
            <div className="verdict">You&apos;re on the wrong network.</div>
            <div className="row">
              <button className="btn-primary" onClick={() => switchChain({ chainId: ritualChain.id })}>
                Switch to Ritual Chain
              </button>
            </div>
          </div>
        )}

        <div className="card" ref={consoleRef}>
          <h2>// describe your symptoms</h2>
          <textarea
            placeholder="e.g. Sore throat and mild fever for two days, plus a runny nose. No trouble breathing."
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            disabled={busy}
          />

          <div className="examples">
            <span className="examples-label">try:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex.label} type="button" className="chip"
                onClick={() => setSymptoms(ex.text)} disabled={busy}>
                {ex.label}
              </button>
            ))}
          </div>

          <div className="row">
            {!isConnected ? (
              <button className="btn-primary" onClick={connectWallet}>
                Connect wallet
              </button>
            ) : wrongChain ? (
              <button
                className="btn-primary"
                onClick={() => switchChain({ chainId: ritualChain.id })}
              >
                ⛓ Switch to Ritual network
              </button>
            ) : (
              <button className="btn-primary" onClick={onTriage} disabled={busy}>
                {busy ? "Working…" : "🔒 Get private triage"}
              </button>
            )}
          </div>

          <div className="privacy-note">
            <span className="ico">🔑</span>
            <span>
              A one-time encryption key is born in your browser. Only its public half
              is sent on-chain; the triage returns sealed to it — unreadable to the
              network, the node, and us.
            </span>
          </div>

          {showPipeline && (
            <div className="pipeline">
              {STEPS.map((s, i) => {
                const state = i < activeStep ? "done" : i === activeStep ? "active" : "";
                return (
                  <div key={s.key} className={`step ${state}`}>
                    <span className="bullet">
                      {state === "done" ? "✓" : state === "active" ? <span className="spinner" /> : i + 1}
                    </span>
                    {s.label}
                  </div>
                );
              })}
            </div>
          )}

          {error && <div className="error">⚠ {error}</div>}
        </div>

        {triage && phase === "done" && (
          <div className="card result" ref={resultRef}>
            <div className="result-head">
              <h3>Your triage</h3>
              {riskKey && (
                <span className={`risk ${RISK_CLASS[riskKey] || ""}`}>
                  <span className="ring" /> {triage.risk_level}
                </span>
              )}
            </div>

            {summaryText && (
              <ScrambleText
                className="summary"
                text={summaryText}
                duration={1300}
                onDone={() => setRevealAdvice(true)}
              />
            )}

            {revealAdvice && triage.advice && triage.advice.length > 0 && (
              <ul className="advice" ref={adviceRef}>
                {triage.advice.map((a, i) => (
                  <li key={i}><span className="arrow">→</span>{a}</li>
                ))}
              </ul>
            )}

            {revealAdvice && typeof triage.see_doctor === "boolean" && (
              <p className="verdict">
                {triage.see_doctor ? "👩‍⚕️ Seeing a doctor is recommended." : "🟢 Self-care is likely reasonable for now."}
              </p>
            )}

            <p className="disclaimer">
              {triage.disclaimer || "Informational only — not a substitute for professional medical care."}
            </p>

            <div className="result-foot">
              <span className="badge-enc">
                {encrypted ? "🔒 decrypted locally" : "⚠ plaintext result"}
              </span>
              {txHash && (
                <a href={`https://explorer.ritualfoundation.org/tx/${txHash}`} target="_blank" rel="noreferrer">
                  view transaction ↗
                </a>
              )}
            </div>
          </div>
        )}

        <div className="foot">
          built on ritual chain · llm precompile 0x0802 · ecies private outputs
          <br />
          MediCrypt is a demo. In an emergency, contact local emergency services.
        </div>
      </div>
    </>
  );
}
