import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // happy-dom by default because most of this app's tests mount components. Files that assert
    // purity — `test/perf.spec.ts` — opt into the Node environment with a per-file
    // `@vitest-environment` pragma, which is the only way to prove a module never touches the DOM.
    environment: 'happy-dom',
    include: ['test/**/*.{spec,test}.{ts,tsx}', 'src/**/*.{spec,test}.{ts,tsx}'],
  },
});
