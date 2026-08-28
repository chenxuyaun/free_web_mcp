"""Evidence-domain helpers for the MCP layer.

Two kinds of logic live here:

1. Local, stateless functions (claim extraction, counter-evidence search
   directions) — deterministic rule sets mirroring packages/evidence (TS).
2. An HTTP client for the evidence API owned by the Next.js dashboard
   (persistence + hashing happen there; the MCP layer never touches storage).
"""

import re
from dataclasses import dataclass

import httpx

from free_web_mcp.errors import ErrorCode, ToolError
from free_web_mcp.logging import get_logger

logger = get_logger(__name__)

CLAIM_TYPES = ("fact", "event", "number", "date", "relationship", "opinion", "inference")

_OPINION_RE = re.compile(
    r"(我认为|我觉得|在我看来|i think|i believe|arguably|probably|maybe|seems like)", re.IGNORECASE
)
_INFERENCE_RE = re.compile(
    r"(因此|所以|意味着|这表明|thus|therefore|implies|suggests|indicates)", re.IGNORECASE
)
_NUMBER_RE = re.compile(r"\d+[.,]?\d*%|\$\s?\d+|\d+\s*(?:million|billion|亿|万|人|台|家)", re.IGNORECASE)
_EVENT_RE = re.compile(
    r"(发布|宣布|推出|收购|上市|launched|released|announced|acquired|listed|happened)", re.IGNORECASE
)
_DATE_RE = re.compile(
    r"(?:19|20)\d{2}\s*年|\b(?:19|20)\d{2}\b|january|february|march|april|may|june|july"
    r"|august|september|october|november|december",
    re.IGNORECASE,
)
_RELATIONSHIP_RE = re.compile(
    r"(与|和|相比|高于|低于|大于|小于|more than|less than|compared to|vs\.?|related to)", re.IGNORECASE
)


def classify_claim(sentence: str) -> str:
    s = sentence.lower()
    if _OPINION_RE.search(s):
        return "opinion"
    if _INFERENCE_RE.search(s):
        return "inference"
    if _NUMBER_RE.search(s):
        return "number"
    # Events before dates: "released ... in 2024" is an event claim.
    if _EVENT_RE.search(s):
        return "event"
    if _DATE_RE.search(s):
        return "date"
    if _RELATIONSHIP_RE.search(s):
        return "relationship"
    return "fact"


@dataclass(frozen=True)
class Claim:
    id: str
    text: str
    type: str


def extract_claims(text: str) -> list[Claim]:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?。！？])\s+", text) if len(s.strip()) >= 8]
    return [
        Claim(id=f"claim_{i + 1:03d}", text=s, type=classify_claim(s))
        for i, s in enumerate(sentences)
    ]


def counter_evidence_searches(claim: str) -> list[str]:
    return [
        f'"{claim}" 辟谣',
        f'"{claim}" fact check',
        f'"{claim}" debunked',
        f'"{claim}" false',
        f'"{claim}" correction',
    ]


class EvidenceApiClient:
    """Thin HTTP client for the dashboard's evidence API."""

    def __init__(self, base_url: str, timeout: float = 10.0) -> None:
        self._base = base_url.rstrip("/")
        self._timeout = timeout

    def create_evidence_record(
        self,
        claim: str,
        claim_type: str,
        supporting: list[dict[str, str]],
        contradicting: list[dict[str, str]] | None = None,
        counter_searches: list[str] | None = None,
        cross_verified: bool = False,
    ) -> dict[str, object]:
        payload = {
            "claim": {"text": claim, "type": claim_type},
            "supporting": supporting,
            "contradicting": contradicting or [],
            "counterSearches": counter_searches or [],
            "crossVerified": cross_verified,
        }
        return self._post("/api/evidence", payload)

    def get_evidence(self, evidence_id: str) -> dict[str, object]:
        return self._get(f"/api/evidence/{evidence_id}")

    def _post(self, path: str, payload: dict[str, object]) -> dict[str, object]:
        try:
            response = httpx.post(
                f"{self._base}{path}", json=payload, timeout=self._timeout
            )
        except httpx.HTTPError as exc:
            raise ToolError(
                ErrorCode.FETCH_FAILED,
                "Evidence API is unreachable. Is the dashboard running?",
            ) from exc
        return self._handle(response)

    def _get(self, path: str) -> dict[str, object]:
        try:
            response = httpx.get(f"{self._base}{path}", timeout=self._timeout)
        except httpx.HTTPError as exc:
            raise ToolError(
                ErrorCode.FETCH_FAILED,
                "Evidence API is unreachable. Is the dashboard running?",
            ) from exc
        return self._handle(response)

    @staticmethod
    def _handle(response: httpx.Response) -> dict[str, object]:
        if response.status_code >= 400:
            try:
                body = response.json()
                error = body.get("error", {})
                raise ToolError(
                    ErrorCode(str(error.get("type", "HTTP_ERROR"))),
                    str(error.get("message", f"Evidence API returned HTTP {response.status_code}.")),
                )
            except (ValueError, AttributeError):
                raise ToolError(
                    ErrorCode.HTTP_ERROR,
                    f"Evidence API returned HTTP {response.status_code}.",
                ) from None
        data = response.json()
        if not isinstance(data, dict):
            raise ToolError(ErrorCode.PARSER_ERROR, "Evidence API returned an unexpected payload.")
        return data
