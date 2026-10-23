"""Guards that hold even if someone bypasses place_order / cancel_order."""

import uuid

import pytest

from tests.db.helpers import place, product_id, raises_sqlstate

UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"
CHECK_VIOLATION = "23514"
INSUFFICIENT_PRIVILEGE = "42501"


def _insert_order(db, **overrides):
    values = {
        "idempotency_key": str(uuid.uuid4()),
        "product_id": product_id(db, "Pen"),
        "quantity": 1,
        "unit_price": 20,
        "customer_name": "Asha",
        **overrides,
    }
    columns = ", ".join(values)
    placeholders = ", ".join(["%s"] * len(values))
    db.execute(f"insert into orders ({columns}) values ({placeholders})", tuple(values.values()))


def test_duplicate_idempotency_key_is_rejected(db):
    key = str(uuid.uuid4())
    _insert_order(db, idempotency_key=key)
    with raises_sqlstate(UNIQUE_VIOLATION):
        _insert_order(db, idempotency_key=key)


@pytest.mark.parametrize(
    "overrides",
    [
        {"quantity": 0},
        {"quantity": 21},
        {"customer_name": "  "},
        {"customer_name": "a" * 61},
        {"unit_price": -1},
    ],
)
def test_order_check_constraints(db, overrides):
    with raises_sqlstate(CHECK_VIOLATION):
        _insert_order(db, **overrides)


def test_invalid_status_is_rejected(db):
    order = place(db, product_id(db, "Pen"))
    with raises_sqlstate(CHECK_VIOLATION):
        db.execute("update orders set status = 'shipped' where id = %s", (order["id"],))


def test_stock_cannot_go_negative(db):
    with raises_sqlstate(CHECK_VIOLATION):
        db.execute("update products set stock = -1 where name = 'Pen'")


def test_product_with_orders_cannot_be_deleted(db):
    place(db, product_id(db, "Pen"))
    with raises_sqlstate(FOREIGN_KEY_VIOLATION):
        db.execute("delete from products where name = 'Pen'")


def test_updated_at_changes_on_update(db):
    db.execute("update products set price = 25 where name = 'Pen'")
    created, updated = db.execute("select created_at, updated_at from products where name = 'Pen'").fetchone()
    assert updated > created


def test_row_level_security_is_enabled(db):
    rows = db.execute(
        "select relname, relrowsecurity from pg_class where relname in ('products', 'orders') order by relname"
    ).fetchall()
    assert rows == [("orders", True), ("products", True)]


@pytest.mark.parametrize("role", ["anon", "authenticated"])
@pytest.mark.parametrize(
    "call",
    [
        "select place_order(gen_random_uuid(), gen_random_uuid(), 1, 'x')",
        "select cancel_order(gen_random_uuid())",
    ],
)
def test_public_roles_cannot_call_order_functions(db, role, call):
    db.execute(f"set role {role}")
    with raises_sqlstate(INSUFFICIENT_PRIVILEGE):
        db.execute(call)
