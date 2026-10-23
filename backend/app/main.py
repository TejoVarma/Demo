from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.core.errors import register_error_handlers
from app.core.supabase import init_supabase
from app.routers import health, orders, products


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    await init_supabase()
    yield


app = FastAPI(title="Shop API", lifespan=lifespan)
register_error_handlers(app)

# Routes have no /api prefix: the frontend calls /api/*, and the Vite proxy (dev) or
# Amplify rewrite (prod) strips /api before forwarding here.
app.include_router(health.router)
app.include_router(products.router)
app.include_router(orders.router)
