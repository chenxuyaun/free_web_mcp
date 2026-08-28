from enum import StrEnum

from pydantic import BaseModel


class ErrorCode(StrEnum):
    INVALID_URL = "INVALID_URL"
    FETCH_FAILED = "FETCH_FAILED"
    TIMEOUT = "TIMEOUT"
    HTTP_ERROR = "HTTP_ERROR"
    PARSER_ERROR = "PARSER_ERROR"
    SEARCH_FAILED = "SEARCH_FAILED"
    RATE_LIMITED = "RATE_LIMITED"
    CONTENT_TOO_LARGE = "CONTENT_TOO_LARGE"
    RENDER_FAILED = "RENDER_FAILED"
    RENDER_TIMEOUT = "RENDER_TIMEOUT"


class ToolError(Exception):
    """Business-level error mapped to a stable error code for MCP clients."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class ToolErrorPayload(BaseModel):
    type: ErrorCode
    message: str


class ErrorResult(BaseModel):
    success: bool = False
    error: ToolErrorPayload
