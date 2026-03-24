import { createModelResponse } from "../../lib/model-proxy.js";

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
    const data = await createModelResponse(body, process.env);
    return new Response(JSON.stringify(data), { status: 200, headers });
  } catch (err) {
    const data = await createModelResponse(null, process.env);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers,
    });
  }
};

export const config = {
  path: "/api/anthropic",
};
