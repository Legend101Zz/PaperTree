const path = require("node:path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace packages export RAW TYPESCRIPT (`"exports": { ".": "./src/index.ts" }`), so Next
  // has to compile them rather than treat them as prebuilt deps. Without this the build fails on
  // the first `.ts` file it meets inside node_modules.
  transpilePackages: [
    "@papertree/document-ir",
    "@papertree/anchoring",
    "@papertree/ui",
  ],

  webpack: (config, { isServer }) => {
    // `canvas` is pdf.js's OPTIONAL Node-side renderer. PDFs are rendered in the BROWSER here, and
    // pnpm-workspace.yaml blocks its build script on purpose (it predates Node 22 and fails at
    // node-gyp configure on ubuntu). Aliasing it away stops webpack trying to follow the import.
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;

    if (!isServer) {
      // ─── INTERIM WORKAROUND FOR ISSUE #33 — delete when that lands ────────────────────────────
      //
      // `@papertree/document-ir`'s barrel re-exports `identity.js`, which imports `node:crypto` at
      // module scope, and the package declares no `"sideEffects": false`. So importing it for
      // `polygonExtent` alone drags `node:crypto` into the client bundle, which webpack 5 will not
      // resolve. That package is Epic 0's; the fix was requested as issue #33.
      //
      // The stub THROWS rather than returning a fake digest. Nothing in the browser should ever
      // call `createHash` — `@papertree/anchoring` compares content hashes the IR already carries
      // and never computes one — so if this is ever reached, that is a real bug and it should be
      // loud. A polyfill returning plausible-but-wrong digests would be far worse: it would mint
      // block ids that match nothing, silently.
      const cryptoStub = path.resolve(__dirname, "src/lib/pdf/node-crypto-stub.ts");
      config.resolve.alias["node:crypto"] = cryptoStub;
      config.resolve.alias.crypto = cryptoStub;
    }

    config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    return config;
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // `credentialless` rather than `require-corp`: the worker is same-origin now
          // (public/pdf.worker.min.mjs), so nothing here needs to opt a third party in.
          { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
