import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Balises gérées par Lit, que Vue ne doit pas essayer de résoudre comme composants
const CUSTOM_ELEMENTS = ['timer-gauge', 'jcb-gauge']

export default defineConfig({
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => CUSTOM_ELEMENTS.includes(tag),
        },
      },
    }),
  ],
  server: {
    // Accessible depuis les téléphones du réseau local (http://<ip-du-pc>:5173)
    host: true,
    port: 5173,
  },
})
