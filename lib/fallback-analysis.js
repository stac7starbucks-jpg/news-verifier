const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;
const SENSATIONAL_PATTERNS = [
  { label: "Sensational wording", pattern: /\b(shocking|breaking|must see|exposed|secret|bombshell|dead|hoax|scam|urgent)\b/i, penalty: 12 },
  { label: "Fear or urgency cues", pattern: /\b(act now|immediately|before it is deleted|share this|warning|alert)\b/i, penalty: 12 },
  { label: "Conspiracy framing", pattern: /\b(they don't want you to know|cover-?up|mainstream media won't tell you)\b/i, penalty: 15 },
];

const PROPAGANDA_RULES = [
  { label: "Emotional language", pattern: /\b(shocking|evil|corrupt|traitor|disaster|outrage)\b/i },
  { label: "Urgency cues", pattern: /\b(act now|share this|before it's deleted|urgent)\b/i },
  { label: "Conspiracy framing", pattern: /\b(cover-?up|they don't want you to know|hidden truth)\b/i },
  { label: "Absolute certainty", pattern: /\b(proven|undeniable|everyone knows|always|never)\b/i },
];

const SUSPICIOUS_TLDS = new Set(["zip", "top", "click", "gq", "xyz", "work", "country"]);
const SOCIAL_DOMAINS = ["facebook.com", "x.com", "twitter.com", "instagram.com", "tiktok.com", "youtube.com"];
const FORUM_DOMAINS = ["reddit.com", "quora.com", "stackexchange.com"];
const NEWS_HINTS = ["news", "times", "post", "journal", "herald", "press", "media"];
const SHOPPING_HINTS = ["shop", "store", "deal", "sale", "mart"];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getUserPayload(messages = []) {
  const texts = [];
  let imageCount = 0;

  for (const message of messages) {
    if (!message || message.role !== "user") continue;

    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!block) continue;

        if (block.type === "text" && typeof block.text === "string") {
          texts.push(block.text);
        }

        if (block.type === "image") {
          imageCount += 1;
        }
      }

      continue;
    }

    if (typeof message.content === "string") {
      texts.push(message.content);
    }
  }

  return {
    text: texts.join("\n\n").trim(),
    imageCount,
  };
}

function extractUrls(text) {
  const matches = text.match(URL_PATTERN) || [];
  return [...new Set(matches)];
}

function detectCategory(hostname) {
  const host = hostname.toLowerCase();

  if (host.endsWith(".gov")) return "Government";
  if (SOCIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "Social Media";
  if (FORUM_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return "Forum";
  if (SHOPPING_HINTS.some((term) => host.includes(term))) return "Shopping";
  if (NEWS_HINTS.some((term) => host.includes(term))) return "News";
  return "Blog";
}

async function inspectUrl(rawUrl) {
  const base = {
    is_url_analyzed: false,
    safety_status: "Unknown",
    domain_age: "Unknown",
    https_secure: null,
    flags: [],
    redirect_risk: "Unknown",
    category: "Unknown",
  };

  if (!rawUrl) {
    return { linkSafety: base, source: null, suspicionBoost: 0 };
  }

  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    return {
      linkSafety: {
        ...base,
        is_url_analyzed: true,
        safety_status: "Suspicious",
        flags: ["Malformed URL"],
      },
      source: null,
      suspicionBoost: 20,
    };
  }

  const flags = [];
  let suspicionBoost = 0;
  let redirectRisk = "Low";
  let pageTitle = "";
  let finalUrl = rawUrl;

  const hostname = url.hostname.toLowerCase();
  const category = detectCategory(hostname);
  const httpsSecure = url.protocol === "https:";

  if (!httpsSecure) {
    flags.push("Uses insecure HTTP");
    suspicionBoost += 20;
  }

  if (hostname.startsWith("xn--")) {
    flags.push("Punycode domain");
    suspicionBoost += 20;
  }

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    flags.push("Raw IP address URL");
    suspicionBoost += 20;
  }

  const hostParts = hostname.split(".");
  const tld = hostParts[hostParts.length - 1];

  if (SUSPICIOUS_TLDS.has(tld)) {
    flags.push(`High-risk TLD: .${tld}`);
    suspicionBoost += 15;
  }

  if ((hostname.match(/-/g) || []).length >= 3) {
    flags.push("Excessive hyphens in domain");
    suspicionBoost += 8;
  }

  if (/(login|verify|secure|update|wallet|bonus|free-money|gift)/i.test(`${hostname}${url.pathname}`)) {
    flags.push("Login or bait keywords in URL");
    suspicionBoost += 18;
  }

  if (url.search.length > 120) {
    flags.push("Long tracking query string");
    suspicionBoost += 6;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Verifai-Pro-Fallback/1.0",
      },
    });

    clearTimeout(timeoutId);
    finalUrl = response.url || rawUrl;

    if (response.redirected) {
      redirectRisk = "Medium";

      try {
        const finalHostname = new URL(finalUrl).hostname.toLowerCase();
        if (finalHostname !== hostname) {
          flags.push("Redirects to a different domain");
          suspicionBoost += 10;
          redirectRisk = "High";
        }
      } catch {
        flags.push("Redirect target could not be parsed");
      }
    }

    if (!response.ok) {
      flags.push(`Destination returned HTTP ${response.status}`);
      suspicionBoost += 8;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      flags.push("Destination is not a standard HTML page");
    } else {
      const html = await response.text();
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      pageTitle = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || "";
    }
  } catch (error) {
    flags.push("Could not fetch the URL directly");
    suspicionBoost += 8;
    redirectRisk = "Unknown";
  }

  let safetyStatus = "Safe";
  if (suspicionBoost >= 35) safetyStatus = "Dangerous";
  else if (suspicionBoost >= 15) safetyStatus = "Suspicious";

  return {
    linkSafety: {
      is_url_analyzed: true,
      safety_status: safetyStatus,
      domain_age: "Unknown",
      https_secure: httpsSecure,
      flags,
      redirect_risk: redirectRisk,
      category,
    },
    source: {
      claim: pageTitle ? `Fetched URL title: ${pageTitle}` : `Checked destination: ${rawUrl}`,
      verdict: suspicionBoost >= 20 ? "Unverified" : "Confirmed",
      source: finalUrl,
    },
    suspicionBoost,
  };
}

function scoreTextSignals(text, imageCount) {
  const lowered = text.toLowerCase();
  const redFlags = [];
  const propagandaPatterns = [];
  let suspicion = 0;

  for (const rule of SENSATIONAL_PATTERNS) {
    if (rule.pattern.test(text)) {
      redFlags.push(rule.label);
      suspicion += rule.penalty;
    }
  }

  for (const rule of PROPAGANDA_RULES) {
    if (rule.pattern.test(text)) {
      propagandaPatterns.push(rule.label);
    }
  }

  if (text && text.length < 30) {
    redFlags.push("Very short claim with little context");
    suspicion += 10;
  }

  if (text && !extractUrls(text).length && !/\baccording to|source|reported by|study|official\b/i.test(lowered)) {
    redFlags.push("No supporting source cited");
    suspicion += 8;
  }

  if ((text.match(/[!?]/g) || []).length >= 4) {
    redFlags.push("Heavy punctuation emphasis");
    suspicion += 6;
  }

  if (/\b[A-Z]{4,}\b/.test(text)) {
    redFlags.push("All-caps emphasis");
    suspicion += 6;
  }

  if (imageCount > 0) {
    redFlags.push("Image content could not be deeply inspected without a live AI model");
    suspicion += 5;
  }

  return {
    suspicion,
    redFlags: [...new Set(redFlags)],
    propagandaPatterns: [...new Set(propagandaPatterns)],
  };
}

function decideAiWriting(text) {
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const structured = /[:;-]\s|\n\d+\./.test(text);
  const firstPerson = /\b(I|we|my|our)\b/i.test(text);

  if (wordCount >= 120 && structured && !firstPerson) {
    return "Possibly AI-generated";
  }

  if (wordCount >= 220 && /\bmoreover|additionally|furthermore|overall\b/i.test(text)) {
    return "Possibly AI-generated";
  }

  return "Likely Human-written";
}

function buildCredibilitySummary(truthScore, linkSafety, hasSource, usedFallback) {
  const parts = [];

  if (hasSource) parts.push("The content included at least one URL that could be inspected.");
  else parts.push("The content did not provide a directly verifiable source.");

  if (linkSafety.is_url_analyzed) {
    parts.push(`The linked destination looked ${linkSafety.safety_status.toLowerCase()} from basic technical checks.`);
  }

  if (truthScore >= 65) parts.push("The wording did not show many obvious misinformation cues.");
  else if (truthScore >= 40) parts.push("The claim needs verification because the signal is mixed.");
  else parts.push("The claim shows several trust-reducing signals and should be treated cautiously.");

  if (usedFallback) {
    parts.push("This run used the built-in fallback analyzer instead of Anthropic.");
  }

  return parts.join(" ");
}

function buildExplanation(text, usedFallback, fallbackReason, urlInfo, truthScore, redFlags) {
  const sentences = [];

  if (usedFallback) {
    sentences.push(`Anthropic was unavailable for this request (${fallbackReason}), so Verifai used its built-in fallback analyzer.`);
  }

  if (urlInfo.linkSafety.is_url_analyzed) {
    sentences.push(`The URL check rated the destination as ${urlInfo.linkSafety.safety_status.toLowerCase()} with ${urlInfo.linkSafety.flags.length || "no"} notable technical flags.`);
  }

  if (text && text.length < 40) {
    sentences.push("The claim is extremely short and does not provide evidence, which lowers confidence.");
  } else if (truthScore < 50) {
    sentences.push("The wording includes signals commonly seen in unverified or low-context claims.");
  } else {
    sentences.push("The wording itself is relatively neutral, but the claim still needs outside confirmation.");
  }

  if (redFlags.length) {
    sentences.push(`Main caution points: ${redFlags.slice(0, 3).join(", ")}.`);
  }

  return sentences.join(" ");
}

function buildVerdict(truthScore, linkSafety, suspicionScore) {
  if (linkSafety.safety_status === "Dangerous") return "Likely False";
  if (truthScore >= 70) return "Likely True";
  if (truthScore <= 30 || suspicionScore >= 35) return "Misleading";
  return "Unverified";
}

export async function createFallbackAnthropicResponse(payload, fallbackReason = "Anthropic unavailable") {
  const { text, imageCount } = getUserPayload(payload?.messages || []);
  const urls = extractUrls(text);
  const primaryUrl = urls[0] || (text && /^https?:\/\//i.test(text.trim()) ? text.trim() : "");
  const urlInfo = await inspectUrl(primaryUrl);
  const textSignals = scoreTextSignals(text, imageCount);
  const suspicionScore = clamp(textSignals.suspicion + urlInfo.suspicionBoost, 0, 100);
  const sourceBonus = primaryUrl
    ? urlInfo.linkSafety.safety_status === "Safe" ? 10 : 5
    : 0;
  const truthScore = clamp(58 + sourceBonus - suspicionScore, 5, 85);
  const finalVerdict = buildVerdict(truthScore, urlInfo.linkSafety, suspicionScore);
  const trustPercent = clamp(Math.round(truthScore), 0, 100);
  const doubtPercent = 100 - trustPercent;
  const usedFallback = true;

  const analysis = {
    truth_score: truthScore,
    ai_generated: decideAiWriting(text),
    link_safety: urlInfo.linkSafety,
    web_verified_sources: urlInfo.source ? [urlInfo.source] : [],
    propaganda_patterns: textSignals.propagandaPatterns,
    red_flags: textSignals.redFlags,
    source_credibility: buildCredibilitySummary(truthScore, urlInfo.linkSafety, Boolean(primaryUrl), usedFallback),
    account_reliability: {
      score: clamp(Math.round(100 - suspicionScore * 1.1), 5, 80),
      insight: primaryUrl
        ? "Reliability was estimated from the available URL and language cues only."
        : "Reliability was estimated from language cues because no direct source was provided.",
    },
    viral_risk: suspicionScore >= 45 ? "High" : suspicionScore >= 20 ? "Medium" : "Low",
    crowd_verification: {
      trust_percent: trustPercent,
      doubt_percent: doubtPercent,
    },
    final_verdict: finalVerdict,
    confidence_note: "Fallback analysis was used because the Anthropic request could not be completed. This result is heuristic and should be verified with trusted reporting or official sources.",
    explanation: buildExplanation(text, usedFallback, fallbackReason, urlInfo, truthScore, textSignals.redFlags),
  };

  return {
    id: `msg_fallback_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: "verifai-fallback-heuristic",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: JSON.stringify(analysis).length,
    },
    content: [
      {
        type: "text",
        text: JSON.stringify(analysis),
      },
    ],
  };
}
