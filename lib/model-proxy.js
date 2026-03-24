import { createFallbackAnthropicResponse } from "./fallback-analysis.js";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function parseJsonSafely(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return { error: raw || "Unexpected upstream response" };
  }
}

function getEnvValue(env, keys) {
  for (const key of keys) {
    const value = env?.[key];
    if (value) return value;
  }

  return "";
}

function toGeminiRole(role) {
  return role === "assistant" || role === "model" ? "model" : "user";
}

function toGeminiPart(part) {
  if (!part) return null;

  if (typeof part === "string") {
    return { text: part };
  }

  if (part.type === "text" && typeof part.text === "string") {
    return { text: part.text };
  }

  if (part.type === "image" && part.source?.type === "base64" && part.source?.data) {
    return {
      inline_data: {
        mime_type: part.source.media_type || "image/jpeg",
        data: part.source.data,
      },
    };
  }

  return null;
}

function toGeminiContents(messages = []) {
  return messages
    .filter((message) => message && (message.content || message.content === ""))
    .map((message) => {
      const parts = Array.isArray(message.content)
        ? message.content.map(toGeminiPart).filter(Boolean)
        : [toGeminiPart(message.content)].filter(Boolean);

      return {
        role: toGeminiRole(message.role),
        parts,
      };
    })
    .filter((content) => content.parts.length > 0);
}

function toGeminiRequest(body = {}) {
  const request = {
    contents: toGeminiContents(body.messages || []),
    generationConfig: {
      maxOutputTokens: body.max_tokens || 1000,
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  if (body.system) {
    request.system_instruction = {
      parts: [{ text: typeof body.system === "string" ? body.system : JSON.stringify(body.system) }],
    };
  }

  return request;
}

function geminiToAnthropicResponse(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("");

  if (!text.trim()) {
    throw new Error(
      data?.promptFeedback?.blockReason
        ? `Gemini blocked the request: ${data.promptFeedback.blockReason}`
        : "Gemini returned no text content"
    );
  }

  return {
    id: data?.responseId || `gemini-${Date.now()}`,
    type: "message",
    role: "assistant",
    model: data?.modelVersion || GEMINI_MODEL,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: data?.usageMetadata?.promptTokenCount || 0,
      output_tokens: data?.usageMetadata?.candidatesTokenCount || 0,
    },
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

async function callGemini(body, geminiKey) {
  const response = await fetch(GEMINI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": geminiKey,
    },
    body: JSON.stringify(toGeminiRequest(body)),
  });

  const raw = await response.text();
  const data = parseJsonSafely(raw);

  if (!response.ok) {
    const message = typeof data?.error?.message === "string"
      ? data.error.message
      : typeof data?.error === "string"
        ? data.error
        : `Gemini request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return geminiToAnthropicResponse(data);
}

async function callAnthropic(body, anthropicKey) {
  const response = await fetch(ANTHROPIC_API_URL, {
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
  const data = parseJsonSafely(raw);

  if (!response.ok) {
    const message = typeof data?.error?.message === "string"
      ? data.error.message
      : typeof data?.error === "string"
        ? data.error
        : `Anthropic request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export async function createModelResponse(body, env = {}) {
  const geminiKey = getEnvValue(env, ["GEMINI_API_KEY", "GOOGLE_API_KEY", "VITE_GEMINI_API_KEY", "VITE_GOOGLE_API_KEY"]);
  const anthropicKey = getEnvValue(env, ["ANTHROPIC_API_KEY", "VITE_ANTHROPIC_API_KEY"]);
  const errors = [];

  if (geminiKey) {
    try {
      return await callGemini(body, geminiKey);
    } catch (error) {
      errors.push(error.message || "Gemini request failed");
    }
  }

  if (anthropicKey) {
    try {
      return await callAnthropic(body, anthropicKey);
    } catch (error) {
      errors.push(error.message || "Anthropic request failed");
    }
  }

  const reason = errors.length
    ? errors.join(" | ")
    : "No Gemini or Anthropic API key is configured";

  return createFallbackAnthropicResponse(body, reason);
}
