from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


class Product(BaseModel):
    id: UUID
    name: str
    price: float
    stock: int


class OrderCreate(BaseModel):
    # Reject unknown fields and coercion ("2", 2.0) so only real whole numbers get through.
    model_config = ConfigDict(extra="forbid")

    product_id: UUID
    quantity: Annotated[int, Field(strict=True, ge=1, le=20)]
    customer_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class Order(BaseModel):
    id: UUID
    product_id: UUID
    product_name: str
    quantity: int
    unit_price: float
    total_price: float
    customer_name: str
    status: Literal["placed", "cancelled"]
    created_at: datetime
    cancelled_at: datetime | None
