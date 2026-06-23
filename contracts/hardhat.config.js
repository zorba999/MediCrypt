/** @type {import('hardhat/config').HardhatUserConfig} */
// MediCrypt uses Hardhat only to compile Solidity (Foundry is not installed on this box).
// Deployment and on-chain smoke tests are done with viem in scripts/ so we control the
// EIP-1559 tx shape and the TLS workaround required by the local AV proxy.
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // The LLM precompile request is a 30-field tuple — viaIR avoids "stack too deep".
      viaIR: true,
    },
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts",
    cache: "./cache",
  },
};
