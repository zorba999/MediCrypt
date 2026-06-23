/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  webpack: (config) => {
    // eciesjs / noble pull in optional WASM fallbacks we don't need in the browser.
    config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    // pino-pretty is an optional dev logger pulled in transitively by WalletConnect; we
    // only use the injected connector, so stub it out to keep the build clean.
    config.resolve.alias = {
      ...config.resolve.alias,
      "pino-pretty": false,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};
