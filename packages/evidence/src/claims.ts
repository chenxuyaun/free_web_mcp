import { Claim, ClaimType } from "./types";

/** Lightweight, deterministic claim extraction (spec §9).
 *  No LLM in v1 — a small rule set splits text into fact/event/number/
 *  date/relationship/opinion/inference candidates. */
export function extractClaims(text: string): Claim[] {
  const claims: Claim[] = [];
  const sentences = text
    .split(/(?<=[.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);

  sentences.forEach((sentence, idx) => {
    const type = classifyClaim(sentence);
    claims.push({ id: `claim_${String(idx + 1).padStart(3, "0")}`, text: sentence, type });
  });

  return claims;
}

export function classifyClaim(sentence: string): ClaimType {
  const s = sentence.toLowerCase();

  // Opinion markers
  if (/(我认为|我觉得|在我看来|i think|i believe|arguably|probably|maybe|seems like)/.test(s)) {
    return "opinion";
  }
  // Inference markers
  if (/(因此|所以|意味着|这表明|thus|therefore|implies|suggests|indicates)/.test(s)) {
    return "inference";
  }
  // Number-heavy claims
  if (/\d+[.,]?\d*%|\$\s?\d+|\d+\s*(million|billion|亿|万|人|台|家)/.test(s)) {
    return "number";
  }
  // Events: past-tense verbs or specific event nouns (before date, so
  // "released ... in 2024" classifies as event, not just date).
  if (/(发布|宣布|推出|收购|上市|launched|released|announced|acquired|listed|happened)/.test(s)) {
    return "event";
  }
  // Date-heavy claims
  if (/(19|20)\d{2}\s*年|\b(19|20)\d{2}\b|january|february|march|april|may|june|july|august|september|october|november|december/.test(s)) {
    return "date";
  }
  // Relationship markers
  if (/(与|和|相比|高于|低于|大于|小于|more than|less than|compared to|vs\.?|related to)/.test(s)) {
    return "relationship";
  }
  // Events: past-tense verbs or specific event nouns
  if (/(发布|宣布|推出|收购|上市|launched|released|announced|acquired|listed|happened)/.test(s)) {
    return "event";
  }
  return "fact";
}
