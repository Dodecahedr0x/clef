import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false, // explicit imports everywhere
  manifest: {
    name: 'Clef',
    description: 'A Solana wallet that explains what you sign.',
    permissions: ['storage', 'alarms'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  vite: () => ({ plugins: [tailwindcss()] }),
});
