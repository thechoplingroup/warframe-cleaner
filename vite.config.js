import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/warframe-cleaner/',
  plugins: [react()],
  server: {
    proxy: {
      '/api/wfm': {
        target: 'https://api.warframe.market',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/wfm/, ''),
        headers: {
          'Accept': 'application/json',
        },
      },
    },
  },
})
