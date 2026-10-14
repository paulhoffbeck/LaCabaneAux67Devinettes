import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

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
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
})
