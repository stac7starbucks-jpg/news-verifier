import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createModelResponse } from './lib/model-proxy.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

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
                  const parsedBody = body ? JSON.parse(body) : {}
                  const data = await createModelResponse(parsedBody, env)
                  res.statusCode = 200
                  res.setHeader('Content-Type', 'application/json')
                  res.setHeader('Access-Control-Allow-Origin', '*')
                  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
                  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                  res.end(JSON.stringify(data))
                } catch (err) {
                  const data = await createModelResponse({}, env)
                  res.statusCode = 200
                  res.setHeader('Content-Type', 'application/json')
                  res.setHeader('Access-Control-Allow-Origin', '*')
                  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
                  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                  res.end(JSON.stringify(data))
                }
              })
            } catch (err) {
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Access-Control-Allow-Origin', '*')
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
              res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
              createModelResponse({}, env)
                .then((data) => res.end(JSON.stringify(data)))
                .catch(() => res.end(JSON.stringify({ error: err.message })))
            }
          })
        },
      },
    ],
  }
})
