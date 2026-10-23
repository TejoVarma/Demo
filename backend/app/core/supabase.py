from supabase import AsyncClient, acreate_client

from app.core.config import settings

# One async client per worker process, created at startup. The sync client's HTTP/2
# connection isn't thread-safe, so it fails under FastAPI's threadpool with concurrent requests.
_client: AsyncClient | None = None


async def init_supabase() -> None:
    global _client
    _client = await acreate_client(settings.supabase_url, settings.supabase_secret_key)


def get_supabase() -> AsyncClient:
    if _client is None:
        raise RuntimeError("Supabase client not initialised; init_supabase() runs at app startup")
    return _client
