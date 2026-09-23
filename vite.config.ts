import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base: './' so the build works on static hosting under any sub-path (e.g. GitHub Pages)
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
