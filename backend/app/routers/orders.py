from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Response, status

from app.core.supabase import get_supabase
from app.schemas import Order, OrderCreate

router = APIRouter(prefix="/orders", tags=["orders"])

_ORDER_COLUMNS = (
    "id, product_id, quantity, unit_price, total_price, customer_name, status, "
    "created_at, cancelled_at, product:products(name)"
)


def _to_order(row: dict) -> dict:
    fields = {key: value for key, value in row.items() if key != "product"}
    return {**fields, "product_name": row["product"]["name"]}


async def _get_order(order_id: str) -> dict:
    result = await get_supabase().table("orders").select(_ORDER_COLUMNS).eq("id", order_id).execute()
    if not result.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return _to_order(result.data[0])


@router.get("", response_model=list[Order])
async def list_orders() -> list[dict]:
    result = await (
        get_supabase()
        .table("orders")
        .select(_ORDER_COLUMNS)
        .order("created_at", desc=True)
        .order("id", desc=True)  # stable order for orders created in the same instant
        .execute()
    )
    return [_to_order(row) for row in result.data]


@router.post(
    "",
    response_model=Order,
    status_code=status.HTTP_201_CREATED,
    responses={200: {"description": "Replay of an earlier request with the same Idempotency-Key"}},
)
async def place_order(
    body: OrderCreate,
    response: Response,
    idempotency_key: UUID = Header(alias="Idempotency-Key"),
) -> dict:
    # Stock check, decrement, insert and idempotency all happen atomically in the database.
    result = await (
        get_supabase()
        .rpc(
            "place_order",
            {
                "p_idempotency_key": str(idempotency_key),
                "p_product_id": str(body.product_id),
                "p_quantity": body.quantity,
                "p_customer_name": body.customer_name,
            },
        )
        .execute()
    )

    if result.data["replayed"]:
        response.status_code = status.HTTP_200_OK
        response.headers["Idempotent-Replayed"] = "true"

    return await _get_order(result.data["id"])


@router.post("/{order_id}/cancel", response_model=Order)
async def cancel_order(order_id: UUID) -> dict:
    # Status change and stock restore happen atomically; a second cancel gets 409.
    result = await get_supabase().rpc("cancel_order", {"p_order_id": str(order_id)}).execute()
    return await _get_order(result.data["id"])
