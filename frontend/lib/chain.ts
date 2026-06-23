import { defineChain } from "viem";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

export const ritualChain = defineChain({
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_RITUAL_RPC_URL ||
          "https://rpc.ritualfoundation.org",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Ritual Explorer",
      url: "https://explorer.ritualfoundation.org",
    },
  },
});

export const wagmiConfig = createConfig({
  chains: [ritualChain],
  connectors: [injected()],
  transports: { [ritualChain.id]: http() },
  ssr: true,
});
