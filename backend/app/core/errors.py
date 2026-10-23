import logging
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from postgrest.exceptions import APIError

logger = logging.getLogger(__name__)

# Database functions raise SQLSTATE 'PTxxx' for business errors; xxx is the HTTP status.
_PT_CODE = re.compile(r"^PT(\d{3})$")


async def _handle_api_error(request: Request, exc: APIError) -> JSONResponse:
    match = _PT_CODE.match(exc.code or "")
    if match:
        return JSONResponse(status_code=int(match.group(1)), content={"detail": exc.message})

    logger.error("Supabase error on %s %s: %r", request.method, request.url.path, exc)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong, please try again"})


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(APIError, _handle_api_error)
