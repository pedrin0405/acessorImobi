"""Health check endpoint."""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
import redis.asyncio as aioredis
from app.shared.config import get_settings
from app.shared.database import engine

router = APIRouter()
settings = get_settings()


@router.get("", summary="Health check geral")
async def health():
    checks = {"status": "ok", "services": {}}
    
    # PostgreSQL
    try:
        async with engine.connect() as conn:
            await conn.execute("SELECT 1")
        checks["services"]["postgres"] = "ok"
    except Exception as e:
        checks["services"]["postgres"] = f"error: {e}"
        checks["status"] = "degraded"

    # Redis
    try:
        r = aioredis.from_url(settings.redis_url)
        await r.ping()
        await r.aclose()
        checks["services"]["redis"] = "ok"
    except Exception as e:
        checks["services"]["redis"] = f"error: {e}"
        checks["status"] = "degraded"

    status_code = 200 if checks["status"] == "ok" else 503
    return JSONResponse(checks, status_code=status_code)
