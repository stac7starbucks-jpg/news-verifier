import { createFallbackAnthropicResponse } from "../../lib/fallback-analysis.js";

export default async (req, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const anthropicKey = process.env.ANTHROPIC_API_KEY || process.env.VITE_ANTHROPIC_API_KEY;

    if (!anthropicKey) {
      const fallback = await createFallbackAnthropicResponse(body, "No Anthropic API key is configured");
      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers,
      });
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

      return new Response(JSON.stringify(fallback), {
        status: 200,
        headers,
      });
    }

    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (err) {
    const fallback = await createFallbackAnthropicResponse(null, err.message || "Unexpected server error");

    return new Response(JSON.stringify(fallback), {
      status: 200,
      headers,
    });
  }
};

export const config = {
  path: "/api/anthropic",
};
