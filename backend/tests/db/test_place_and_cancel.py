import uuid

from tests.db.helpers import cancel, order_count, place, product_id, raises_sqlstate, stock


def test_seed_creates_five_products_and_is_rerunnable(db):
    from tests.db.conftest import SEED

    db.execute(SEED.read_text())
    rows = db.execute("select name, price, stock from products order by name").fetchall()
    assert [(name, float(price), qty) for name, price, qty in rows] == [
        ("Eraser", 5.0, 40),
        ("Geometry Box", 150.0, 5),
        ("Notebook", 50.0, 10),
        ("Pen", 20.0, 25),
        ("Pencil", 10.0, 30),
    ]


# --- place_order -------------------------------------------------------------


def test_place_order_reduces_stock_and_records_price(db):
    order = place(db, product_id(db, "Notebook"), quantity=3, name="  Asha  ")

    assert order["replayed"] is False
    assert order["quantity"] == 3
    assert order["unit_price"] == 50
    assert order["total_price"] == 150
    assert order["customer_name"] == "Asha"
    assert order["status"] == "placed"
    assert order["cancelled_at"] is None
    assert stock(db, "Notebook") == 7


def test_place_order_accepts_boundary_values(db):
    place(db, product_id(db, "Pen"), quantity=20, name="a" * 60)
    assert stock(db, "Pen") == 5


def test_order_keeps_its_price_when_product_price_changes(db):
    order = place(db, product_id(db, "Notebook"), quantity=2)
    db.execute("update products set price = 80 where name = 'Notebook'")

    row = db.execute("select unit_price, total_price from orders where id = %s", (order["id"],)).fetchone()
    assert (row[0], row[1]) == (50, 100)


def test_can_buy_exactly_the_remaining_stock(db):
    place(db, product_id(db, "Geometry Box"), quantity=5)
    assert stock(db, "Geometry Box") == 0


def test_insufficient_stock_is_rejected_without_changes(db):
    with raises_sqlstate("PT409", match="Insufficient stock: only 5 left, requested 6"):
        place(db, product_id(db, "Geometry Box"), quantity=6)

    assert stock(db, "Geometry Box") == 5
    assert order_count(db) == 0


def test_unknown_product_is_rejected(db):
    with raises_sqlstate("PT404", match="Product not found"):
        place(db, str(uuid.uuid4()))


def test_invalid_quantity_is_rejected(db):
    pid = product_id(db, "Pen")
    for quantity in (0, -1, 21, None):
        with raises_sqlstate("PT422", match="Quantity must be a whole number between 1 and 20"):
            place(db, pid, quantity=quantity)
    assert stock(db, "Pen") == 25


def test_invalid_customer_name_is_rejected(db):
    pid = product_id(db, "Pen")
    for name in ("", "   ", None, "a" * 61):
        with raises_sqlstate("PT422", match="Customer name is required"):
            place(db, pid, name=name)
    assert order_count(db) == 0


def test_missing_idempotency_key_is_rejected(db):
    with raises_sqlstate("PT400", match="Idempotency key is required"):
        db.execute("select place_order(null, %s, 1, 'Asha')", (product_id(db, "Pen"),))


# --- idempotency ---------------------------------------------------------------


def test_same_key_and_order_returns_original_without_new_stock_change(db):
    pid, key = product_id(db, "Notebook"), str(uuid.uuid4())

    first = place(db, pid, quantity=2, name="Asha", key=key)
    # Whitespace around the name is trimmed before comparing, so this is the same order.
    retry = place(db, pid, quantity=2, name=" Asha ", key=key)

    assert first["replayed"] is False
    assert retry["replayed"] is True
    assert retry["id"] == first["id"]
    assert stock(db, "Notebook") == 8
    assert order_count(db) == 1


def test_same_key_with_different_order_is_rejected(db):
    notebook, pen, key = product_id(db, "Notebook"), product_id(db, "Pen"), str(uuid.uuid4())
    place(db, notebook, quantity=2, name="Asha", key=key)

    for product, quantity, name in ((notebook, 3, "Asha"), (pen, 2, "Asha"), (notebook, 2, "Ravi")):
        with raises_sqlstate("PT422", match="already used for a different order"):
            place(db, product, quantity=quantity, name=name, key=key)

    assert stock(db, "Notebook") == 8
    assert stock(db, "Pen") == 25
    assert order_count(db) == 1


def test_failed_attempt_does_not_consume_the_key(db):
    pid, key = product_id(db, "Geometry Box"), str(uuid.uuid4())
    with raises_sqlstate("PT409"):
        place(db, pid, quantity=6, key=key)

    # Nothing was stored, so the same key can be used once the request is valid.
    assert place(db, pid, quantity=5, key=key)["replayed"] is False


# --- cancel_order ----------------------------------------------------------------


def test_cancel_marks_cancelled_and_restores_stock(db):
    order = place(db, product_id(db, "Notebook"), quantity=4)

    cancelled = cancel(db, order["id"])

    assert cancelled["status"] == "cancelled"
    assert cancelled["cancelled_at"] is not None
    assert stock(db, "Notebook") == 10


def test_cancelling_twice_is_rejected_and_restores_stock_once(db):
    order = place(db, product_id(db, "Notebook"), quantity=4)
    cancel(db, order["id"])

    with raises_sqlstate("PT409", match="Order is already cancelled"):
        cancel(db, order["id"])
    assert stock(db, "Notebook") == 10


def test_cancel_unknown_order_is_rejected(db):
    with raises_sqlstate("PT404", match="Order not found"):
        cancel(db, str(uuid.uuid4()))


def test_replaying_a_cancelled_orders_key_does_not_reorder(db):
    pid, key = product_id(db, "Notebook"), str(uuid.uuid4())
    order = place(db, pid, quantity=2, key=key)
    cancel(db, order["id"])

    retry = place(db, pid, quantity=2, key=key)

    assert retry["replayed"] is True
    assert retry["status"] == "cancelled"
    assert stock(db, "Notebook") == 10
