import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createFallbackAnthropicResponse } from './lib/fallback-analysis.js'

function safeParseJson(value) {
  try {
    return value ? JSON.parse(value) : {}
  } catch {
    return {}
  }
}

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
                    const fallback = await createFallbackAnthropicResponse(safeParseJson(body), 'No Anthropic API key is configured')
                    res.statusCode = 200
                    res.setHeader('Content-Type', 'application/json')
                    res.setHeader('Access-Control-Allow-Origin', '*')
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
                    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                    return res.end(JSON.stringify(fallback))
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
                  if (!response.ok) {
                    let parsed = {}

                    try {
                      parsed = data ? JSON.parse(data) : {}
                    } catch {
                      parsed = { error: data || `Anthropic request failed with HTTP ${response.status}` }
                    }

                    const fallbackReason = typeof parsed?.error?.message === 'string'
                      ? parsed.error.message
                      : typeof parsed?.error === 'string'
                        ? parsed.error
                        : `Anthropic request failed with HTTP ${response.status}`
                    const fallback = await createFallbackAnthropicResponse(safeParseJson(body), fallbackReason)

                    res.statusCode = 200
                    res.setHeader('Content-Type', 'application/json')
                    res.setHeader('Access-Control-Allow-Origin', '*')
                    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
                    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                    return res.end(JSON.stringify(fallback))
                  }

                  res.statusCode = 200
                  res.setHeader('Content-Type', 'application/json')
                  res.setHeader('Access-Control-Allow-Origin', '*')
                  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
                  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                  res.end(data)
                } catch (err) {
                  const fallback = await createFallbackAnthropicResponse(safeParseJson(body), err.message || 'Unexpected proxy error')
                  res.statusCode = 200
                  res.setHeader('Content-Type', 'application/json')
                  res.setHeader('Access-Control-Allow-Origin', '*')
                  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
                  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
                  res.end(JSON.stringify(fallback))
                }
              })
            } catch (err) {
              res.statusCode = 200
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Access-Control-Allow-Origin', '*')
              res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
              res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
              createFallbackAnthropicResponse({}, err.message || 'Unexpected proxy setup error')
                .then((fallback) => res.end(JSON.stringify(fallback)))
                .catch(() => res.end(JSON.stringify({ error: err.message })))
            }
          })
        },
      },
    ],
  }
})
