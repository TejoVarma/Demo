import uuid

import pytest

from tests.api.conftest import FakeQuery, pt_error

PRODUCT_ID = str(uuid.uuid4())
ORDER_ID = str(uuid.uuid4())

ORDER_ROW = {
    "id": ORDER_ID,
    "product_id": PRODUCT_ID,
    "quantity": 2,
    "unit_price": 50.0,
    "total_price": 100.0,
    "customer_name": "Asha",
    "status": "placed",
    "created_at": "2026-10-23T10:00:00+00:00",
    "cancelled_at": None,
    "product": {"name": "Notebook"},
}


def order_body(**overrides) -> dict:
    return {"product_id": PRODUCT_ID, "quantity": 2, "customer_name": "Asha", **overrides}


def key_header() -> dict:
    return {"Idempotency-Key": str(uuid.uuid4())}


def test_health(api):
    assert api.get("/health").json() == {"status": "ok"}


def test_routes_have_no_api_prefix(api):
    assert api.get("/api/health").status_code == 404


# --- products --------------------------------------------------------------------------


def test_list_products(api, fake):
    product = {"id": PRODUCT_ID, "name": "Notebook", "price": 50.0, "stock": 10}
    fake.tables["products"] = FakeQuery([product])

    response = api.get("/products")

    assert response.status_code == 200
    assert response.json() == [product]


# --- list orders -------------------------------------------------------------------------


def test_list_orders_newest_first_with_product_name(api, fake):
    fake.tables["orders"] = query = FakeQuery([dict(ORDER_ROW)])

    response = api.get("/orders")

    assert response.status_code == 200
    [order] = response.json()
    assert order["product_name"] == "Notebook"
    assert "product" not in order
    assert {k: order[k] for k in ("quantity", "total_price", "status")} == {
        "quantity": 2,
        "total_price": 100.0,
        "status": "placed",
    }
    assert ("order", ("created_at",), {"desc": True}) in query.calls


def test_orders_response_does_not_expose_idempotency_key(api, fake):
    fake.tables["orders"] = FakeQuery([{**ORDER_ROW, "idempotency_key": str(uuid.uuid4())}])
    assert "idempotency_key" not in api.get("/orders").json()[0]


# --- place order -------------------------------------------------------------------------


def test_place_order_new(api, fake):
    fake.rpcs["place_order"] = FakeQuery({"id": ORDER_ID, "replayed": False})
    fake.tables["orders"] = FakeQuery([dict(ORDER_ROW)])
    headers = key_header()

    response = api.post("/orders", json=order_body(customer_name="  Asha  "), headers=headers)

    assert response.status_code == 201
    assert "idempotent-replayed" not in response.headers
    assert response.json()["id"] == ORDER_ID
    assert fake.rpc_calls == [
        (
            "place_order",
            {
                "p_idempotency_key": headers["Idempotency-Key"],
                "p_product_id": PRODUCT_ID,
                "p_quantity": 2,
                "p_customer_name": "Asha",
            },
        )
    ]


def test_place_order_replay(api, fake):
    fake.rpcs["place_order"] = FakeQuery({"id": ORDER_ID, "replayed": True})
    fake.tables["orders"] = FakeQuery([dict(ORDER_ROW)])

    response = api.post("/orders", json=order_body(), headers=key_header())

    assert response.status_code == 200
    assert response.headers["idempotent-replayed"] == "true"
    assert response.json()["id"] == ORDER_ID


@pytest.mark.parametrize(
    ("label", "body"),
    [
        ("quantity 0", order_body(quantity=0)),
        ("quantity 21", order_body(quantity=21)),
        ("quantity float", order_body(quantity=2.0)),
        ("quantity string", order_body(quantity="2")),
        ("quantity bool", order_body(quantity=True)),
        ("quantity missing", {"product_id": PRODUCT_ID, "customer_name": "Asha"}),
        ("name blank", order_body(customer_name="   ")),
        ("name too long", order_body(customer_name="a" * 61)),
        ("name missing", {"product_id": PRODUCT_ID, "quantity": 2}),
        ("bad product id", order_body(product_id="not-a-uuid")),
        ("extra field", order_body(unit_price=1)),
    ],
)
def test_place_order_invalid_body_never_reaches_database(api, fake, label, body):
    response = api.post("/orders", json=body, headers=key_header())

    assert response.status_code == 422, label
    assert fake.rpc_calls == []


def test_place_order_accepts_boundaries(api, fake):
    fake.rpcs["place_order"] = FakeQuery({"id": ORDER_ID, "replayed": False})
    fake.tables["orders"] = FakeQuery([dict(ORDER_ROW)])

    for body in (order_body(quantity=1), order_body(quantity=20), order_body(customer_name="a" * 60)):
        assert api.post("/orders", json=body, headers=key_header()).status_code == 201


@pytest.mark.parametrize("headers", [{}, {"Idempotency-Key": "not-a-uuid"}], ids=["missing", "invalid"])
def test_place_order_requires_valid_idempotency_key(api, fake, headers):
    response = api.post("/orders", json=order_body(), headers=headers)

    assert response.status_code == 422
    assert fake.rpc_calls == []


@pytest.mark.parametrize(
    ("status", "message"),
    [
        (409, "Insufficient stock: only 1 left, requested 2"),
        (404, "Product not found"),
        (422, "Idempotency key was already used for a different order"),
    ],
)
def test_place_order_database_errors_map_to_http(api, fake, status, message):
    fake.rpcs["place_order"] = FakeQuery(error=pt_error(status, message))

    response = api.post("/orders", json=order_body(), headers=key_header())

    assert response.status_code == status
    assert response.json() == {"detail": message}


def test_unexpected_database_error_is_hidden(api, fake):
    fake.rpcs["place_order"] = FakeQuery(error={"code": "42P01", "message": 'relation "orders" does not exist'})

    response = api.post("/orders", json=order_body(), headers=key_header())

    assert response.status_code == 500
    assert response.json() == {"detail": "Something went wrong, please try again"}


# --- cancel order ------------------------------------------------------------------------


def test_cancel_order(api, fake):
    fake.rpcs["cancel_order"] = FakeQuery({"id": ORDER_ID, "status": "cancelled"})
    fake.tables["orders"] = FakeQuery([{**ORDER_ROW, "status": "cancelled", "cancelled_at": "2026-10-23T11:00:00+00:00"}])

    response = api.post(f"/orders/{ORDER_ID}/cancel")

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert fake.rpc_calls == [("cancel_order", {"p_order_id": ORDER_ID})]


@pytest.mark.parametrize(("status", "message"), [(409, "Order is already cancelled"), (404, "Order not found")])
def test_cancel_order_database_errors_map_to_http(api, fake, status, message):
    fake.rpcs["cancel_order"] = FakeQuery(error=pt_error(status, message))

    response = api.post(f"/orders/{ORDER_ID}/cancel")

    assert response.status_code == status
    assert response.json() == {"detail": message}


def test_cancel_order_invalid_id(api, fake):
    assert api.post("/orders/not-a-uuid/cancel").status_code == 422
    assert fake.rpc_calls == []
