import { defineConfig } from 'vite';

// GitHub Pages serverer projektet under /galoppen/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/galoppen/' : '/',
  server: { port: 5173 },
}));
