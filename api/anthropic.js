import { createFallbackAnthropicResponse } from "../lib/fallback-analysis.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Content-Type", "application/json");

  // Handle preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body;

    const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY

    if (!anthropicKey) {
      const fallback = await createFallbackAnthropicResponse(body, "No Anthropic API key is configured");
      return res.status(200).json(fallback);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "interleaved-thinking-2025-05-14",
      },
      body: JSON.stringify(body),
    });

    const raw = await response.text();
    let data = {};

    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { error: raw || "Unexpected upstream response" };
    }

    if (!response.ok) {
      const fallbackReason = typeof data?.error?.message === "string"
        ? data.error.message
        : typeof data?.error === "string"
          ? data.error
          : `Anthropic request failed with HTTP ${response.status}`;
      const fallback = await createFallbackAnthropicResponse(body, fallbackReason);
      return res.status(200).json(fallback);
    }

    return res.status(200).json(data);
  } catch (err) {
    const fallback = await createFallbackAnthropicResponse(req.body, err.message || "Unexpected server error");
    return res.status(200).json(fallback);
  }
}
