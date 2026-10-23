"""API tests run against a fake Supabase client: no network, no database.

The fake records every query-builder call so tests can assert on what the routes asked
for, and returns canned data (or raises APIError) on execute().
"""

from collections.abc import Callable, Iterator
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

import app.core.supabase as supabase_module
from app.main import app


class FakeQuery:
    def __init__(self, data: Any = None, error: dict | None = None):
        self.data = data
        self.error = error
        self.calls: list[tuple[str, tuple, dict]] = []

    def __getattr__(self, name: str) -> Callable[..., "FakeQuery"]:
        # select / eq / order / ... : record the call and keep chaining.
        def method(*args, **kwargs) -> "FakeQuery":
            self.calls.append((name, args, kwargs))
            return self

        return method

    async def execute(self) -> SimpleNamespace:
        if self.error:
            raise APIError(self.error)
        return SimpleNamespace(data=self.data)


class FakeSupabase:
    def __init__(self) -> None:
        self.tables: dict[str, FakeQuery] = {}
        self.rpcs: dict[str, FakeQuery] = {}
        self.rpc_calls: list[tuple[str, dict]] = []

    def table(self, name: str) -> FakeQuery:
        return self.tables[name]

    def rpc(self, name: str, params: dict) -> FakeQuery:
        self.rpc_calls.append((name, params))
        return self.rpcs[name]


@pytest.fixture
def fake() -> Iterator[FakeSupabase]:
    client = FakeSupabase()
    original = supabase_module._client
    supabase_module._client = client
    yield client
    supabase_module._client = original


@pytest.fixture
def api(fake) -> TestClient:
    # Not used as a context manager, so the lifespan (real client creation) never runs.
    return TestClient(app, raise_server_exceptions=False)


def pt_error(status: int, message: str) -> dict:
    return {"code": f"PT{status}", "message": message, "hint": None, "details": None}
