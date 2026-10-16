import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  imports: false, // explicit imports everywhere
  hooks: {
    // WXT 0.21 still runs unimport with its presets when imports are off, and rewrites workspace packages that merely
    // mention a preset name (e.g. a `getAppConfig()` method in @clef/signers) into unresolvable `wxt/utils/*` imports.
    'config:resolved': (wxt) => {
      wxt.config.imports.presets = [];
    },
  },
  manifest: {
    name: 'Clef',
    description: 'A Solana wallet that explains what you sign.',
    minimum_chrome_version: '137', // WebCrypto Ed25519 on by default
    permissions: ['storage', 'alarms'],
    icons: { 16: 'icon/16.png', 48: 'icon/48.png', 128: 'icon/128.png' },
    action: { default_icon: { 16: 'icon/16.png', 48: 'icon/48.png', 128: 'icon/128.png' } },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
    // Unset by default: the error reporter stays unavailable and the setting hidden.
    define: {
      'import.meta.env.CLEF_ERROR_ENDPOINT': JSON.stringify(process.env.CLEF_ERROR_ENDPOINT ?? ''),
      'import.meta.env.CLEF_HARDWARE': JSON.stringify(process.env.CLEF_HARDWARE ?? ''),
    },
  }),
});
