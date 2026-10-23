"""Concurrent requests, each on its own connection, as PostgREST would run them.

The "burst" tests release many requests at once through a barrier. The "held lock" tests
are deterministic: request A runs in an open transaction, request B is shown to be
blocked behind it, then A commits or rolls back and B's outcome is checked.
"""

import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest

from tests.db.helpers import cancel, order_count, place, product_id, set_stock, stock

BURST = 30


def _attempt(fn, conn) -> tuple[str, object]:
    try:
        return "ok", fn(conn)
    except psycopg.Error as exc:
        return "error", exc.sqlstate


def run_burst(connect, fn, n=BURST) -> list[tuple[str, object]]:
    conns = [connect() for _ in range(n)]
    barrier = threading.Barrier(n)

    def worker(conn):
        barrier.wait()
        return _attempt(fn, conn)

    with ThreadPoolExecutor(n) as pool:
        return list(pool.map(worker, conns))


def run_behind_open_transaction(connect, first, second, finish: str):
    """Run `first` in an open transaction, start `second` and assert it blocks, then finish `first`."""
    holder = connect(autocommit=False)
    first(holder)

    waiter = connect()
    with ThreadPoolExecutor(1) as pool:
        future = pool.submit(_attempt, second, waiter)
        time.sleep(0.5)
        assert not future.done(), "second request should wait for the first transaction's lock"
        getattr(holder, finish)()
        return future.result(timeout=10)


def outcome(result) -> str:
    """'ok' or the error's SQLSTATE."""
    status, value = result
    return status if status == "ok" else value


def count(results, expected: str) -> int:
    return sum(1 for result in results if outcome(result) == expected)


# --- burst ---------------------------------------------------------------------------


def test_many_buyers_for_the_last_unit_only_one_succeeds(db, connect):
    set_stock(db, "Notebook", 1)
    pid = product_id(db, "Notebook")

    results = run_burst(connect, lambda conn: place(conn, pid))

    assert count(results, "ok") == 1
    assert count(results, "PT409") == BURST - 1
    assert stock(db, "Notebook") == 0
    assert order_count(db) == 1


def test_many_buyers_never_oversell(db, connect):
    pid = product_id(db, "Geometry Box")  # stock 5

    results = run_burst(connect, lambda conn: place(conn, pid, quantity=2))

    assert count(results, "ok") == 2
    assert count(results, "PT409") == BURST - 2
    assert stock(db, "Geometry Box") == 1


def test_same_key_burst_creates_exactly_one_order(db, connect):
    pid, key = product_id(db, "Pen"), str(uuid.uuid4())

    results = run_burst(connect, lambda conn: place(conn, pid, quantity=2, key=key))

    assert all(status == "ok" for status, _ in results), results
    orders = [value for _, value in results]
    assert sum(not o["replayed"] for o in orders) == 1
    assert len({o["id"] for o in orders}) == 1
    assert stock(db, "Pen") == 23
    assert order_count(db) == 1


def test_cancel_burst_restores_stock_once(db, connect):
    order = place(db, product_id(db, "Notebook"), quantity=4)

    results = run_burst(connect, lambda conn: cancel(conn, order["id"]))

    assert count(results, "ok") == 1
    assert count(results, "PT409") == BURST - 1
    assert stock(db, "Notebook") == 10


# --- held lock -----------------------------------------------------------------------


@pytest.mark.parametrize(("finish", "expected"), [("commit", "PT409"), ("rollback", "ok")])
def test_second_buyer_of_last_unit_waits_for_first(db, connect, finish, expected):
    set_stock(db, "Notebook", 1)
    pid = product_id(db, "Notebook")

    result = run_behind_open_transaction(
        connect, lambda conn: place(conn, pid), lambda conn: place(conn, pid), finish
    )

    # Committed: the unit is gone. Rolled back: the unit is still there for the second buyer.
    assert outcome(result) == expected
    assert stock(db, "Notebook") == 0
    assert order_count(db) == 1


@pytest.mark.parametrize("finish", ["commit", "rollback"])
def test_same_key_retry_waits_for_in_flight_request(db, connect, finish):
    pid, key = product_id(db, "Pen"), str(uuid.uuid4())
    first_order: dict = {}

    status, retry = run_behind_open_transaction(
        connect,
        lambda conn: first_order.update(place(conn, pid, quantity=2, key=key)),
        lambda conn: place(conn, pid, quantity=2, key=key),
        finish,
    )

    assert status == "ok"
    if finish == "commit":
        assert retry["replayed"] is True
        assert retry["id"] == first_order["id"]
    else:
        assert retry["replayed"] is False  # the first attempt never happened, so the retry creates it
    assert stock(db, "Pen") == 23
    assert order_count(db) == 1


@pytest.mark.parametrize(("finish", "expected"), [("commit", "PT409"), ("rollback", "ok")])
def test_second_cancel_waits_for_first(db, connect, finish, expected):
    order = place(db, product_id(db, "Notebook"), quantity=4)

    result = run_behind_open_transaction(
        connect, lambda conn: cancel(conn, order["id"]), lambda conn: cancel(conn, order["id"]), finish
    )

    assert outcome(result) == expected
    assert stock(db, "Notebook") == 10
