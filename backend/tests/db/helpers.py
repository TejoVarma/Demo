import uuid
from contextlib import contextmanager

import psycopg
import pytest


def product_id(conn: psycopg.Connection, name: str) -> str:
    return str(conn.execute("select id from products where name = %s", (name,)).fetchone()[0])


def stock(conn: psycopg.Connection, name: str) -> int:
    return conn.execute("select stock from products where name = %s", (name,)).fetchone()[0]


def set_stock(conn: psycopg.Connection, name: str, value: int) -> None:
    conn.execute("update products set stock = %s where name = %s", (value, name))


def order_count(conn: psycopg.Connection) -> int:
    return conn.execute("select count(*) from orders").fetchone()[0]


def place(conn, product, quantity=1, name="Asha", key=None) -> dict:
    key = key or str(uuid.uuid4())
    return conn.execute("select place_order(%s, %s, %s, %s)", (key, product, quantity, name)).fetchone()[0]


def cancel(conn, order_id) -> dict:
    row = conn.execute("select to_jsonb(o) from cancel_order(%s) o", (order_id,)).fetchone()
    return row[0]


@contextmanager
def raises_sqlstate(sqlstate: str, match: str | None = None):
    with pytest.raises(psycopg.Error, match=match) as exc_info:
        yield exc_info
    assert exc_info.value.sqlstate == sqlstate, exc_info.value
