import { defineConfig } from 'vite';
// Connection page only. Output: dist (Vercel serves it; api/presence.ts becomes the discovery function).
export default defineConfig({ base: '/', build: { outDir: 'dist', emptyOutDir: true, sourcemap: false, target: 'es2020', rollupOptions: { input: 'index.html' } } });
