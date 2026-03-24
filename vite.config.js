import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const anthropicKey = env.ANTHROPIC_API_KEY || env.VITE_ANTHROPIC_API_KEY || ''

  return {
    plugins: [
      react(),
      {
        name: 'anthropic-dev-proxy',
        configureServer(server) {
          server.middlewares.use(async (req, res, next) => {
            if (req.url === '/api/anthropic' && req.method === 'OPTIONS') {
              res.statusCode = 204
              res.setHeader('Access-Control-Allow-Origin', '*')
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
              res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
              return res.end()
            }

            if (req.url !== '/api/anthropic' || req.method !== 'POST') {
              return next()
            }

            try {
              let body = ''
              req.on('data', (chunk) => (body += chunk))
              req.on('end', async () => {
                try {
                  if (!anthropicKey) {
                    res.statusCode = 400
                    res.setHeader('Content-Type', 'application/json')
                    res.setHeader('Access-Control-Allow-Origin', '*')
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
                    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                    return res.end(JSON.stringify({ error: 'Missing Anthropic API key in environment. Set ANTHROPIC_API_KEY or VITE_ANTHROPIC_API_KEY.' }))
                  }

                  const response = await fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'x-api-key': anthropicKey,
                      'anthropic-version': '2023-06-01',
                      'anthropic-beta': 'interleaved-thinking-2025-05-14',
                    },
                    body: body,
                  })

                  const data = await response.text()
                  res.statusCode = response.status
                  res.setHeader('Content-Type', 'application/json')
                  res.setHeader('Access-Control-Allow-Origin', '*')
                  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
                  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                  res.end(data)
                } catch (err) {
                  res.statusCode = 500
                  res.setHeader('Content-Type', 'application/json')
                  res.setHeader('Access-Control-Allow-Origin', '*')
                  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
                  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                  res.end(JSON.stringify({ error: err.message }))
                }
              })
            } catch (err) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Access-Control-Allow-Origin', '*')
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
              res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
              res.end(JSON.stringify({ error: err.message }))
            }
          })
        },
      },
    ],
  }
})
