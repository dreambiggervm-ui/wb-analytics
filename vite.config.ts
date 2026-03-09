import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      // Все запросы, начинающиеся с /emall-api, Vite будет перенаправлять на сервер Emall,
      // обходя тем самым политику CORS в браузере.
      '/emall-api': {
        target: 'https://api-sandbox.emall.by',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/emall-api/, '')
      }
    }
  }
})