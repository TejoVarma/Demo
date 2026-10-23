from fastapi import APIRouter

from app.core.supabase import get_supabase
from app.schemas import Product

router = APIRouter(prefix="/products", tags=["products"])


@router.get("", response_model=list[Product])
async def list_products() -> list[dict]:
    result = await get_supabase().table("products").select("id, name, price, stock").order("name").execute()
    return result.data
