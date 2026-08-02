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

  webpack: (config) => {
    // `canvas` is pdf.js's OPTIONAL Node-side renderer. PDFs are rendered in the BROWSER here, and
    // pnpm-workspace.yaml blocks its build script on purpose (it predates Node 22 and fails at
    // node-gyp configure on ubuntu). Aliasing it away stops webpack trying to follow the import.
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;

    // The workspace packages are compiled with `moduleResolution: NodeNext` (tsconfig.base.json),
    // which REQUIRES relative imports to carry the emitted `.js` extension — `./match.js` even
    // though the file on disk is `match.ts`. Node resolves that correctly after compilation;
    // webpack, resolving the TypeScript source directly, does not, and fails with
    // "Can't resolve './match.js'".
    //
    // `extensionAlias` is the sanctioned fix: try `.ts`/`.tsx` first for a `.js` specifier, then
    // fall back to a real `.js`. Changing the packages to extensionless imports instead would
    // break them for every Node consumer — the API and the Web Worker both import them directly.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };

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
