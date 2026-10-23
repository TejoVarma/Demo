"""Fixtures that run the real migration and seed against a throwaway local Postgres.

By default a temporary cluster is created with initdb and removed afterwards. Set
TEST_DATABASE_URL to use an existing database instead; it must be on localhost because
every test drops and recreates the public schema.
"""

import os
import shutil
import socket
import subprocess
import tempfile
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

import psycopg
import pytest

SUPABASE_DIR = Path(__file__).resolve().parents[2] / "supabase"
MIGRATIONS = sorted((SUPABASE_DIR / "migrations").glob("*.sql"))
SEED = SUPABASE_DIR / "seed.sql"

# Supabase's API roles; service_role bypasses RLS like the secret key does.
ROLES_SQL = """
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end
$$;
"""


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        if urlparse(url).hostname not in ("localhost", "127.0.0.1", "::1"):
            pytest.exit("TEST_DATABASE_URL must point at localhost: the tests drop the public schema", 2)
        yield url
        return

    if not (shutil.which("initdb") and shutil.which("pg_ctl")):
        pytest.skip("PostgreSQL (initdb, pg_ctl) not found; install it or set TEST_DATABASE_URL")

    datadir = tempfile.mkdtemp(prefix="shop-test-pg-")
    port = _free_port()
    subprocess.run(["initdb", "-D", datadir, "-U", "postgres", "--auth=trust"], check=True, capture_output=True)
    # TCP only: the unix socket path under a long temp dir can exceed the OS limit.
    options = f"-p {port} -c listen_addresses=127.0.0.1 -c unix_socket_directories='' -c max_connections=200"
    subprocess.run(
        ["pg_ctl", "-D", datadir, "-o", options, "-l", f"{datadir}/server.log", "-w", "start"],
        check=True,
        capture_output=True,
    )
    try:
        yield f"postgresql://postgres@127.0.0.1:{port}/postgres"
    finally:
        subprocess.run(["pg_ctl", "-D", datadir, "-m", "fast", "stop"], capture_output=True)
        shutil.rmtree(datadir, ignore_errors=True)


@pytest.fixture
def connect(database_url: str) -> Iterator:
    """Open autocommit connections (one transaction per call, like PostgREST); all closed after the test."""
    conns: list[psycopg.Connection] = []

    def _connect(autocommit: bool = True) -> psycopg.Connection:
        conn = psycopg.connect(database_url, autocommit=autocommit)
        conns.append(conn)
        return conn

    yield _connect
    for conn in conns:
        conn.close()


@pytest.fixture
def db(connect) -> psycopg.Connection:
    """A fresh schema with the migration and seed applied."""
    conn = connect()
    conn.execute("drop schema if exists public cascade; create schema public;")
    conn.execute(ROLES_SQL)
    conn.execute("grant usage on schema public to anon, authenticated, service_role")
    for migration in MIGRATIONS:
        conn.execute(migration.read_text())
    conn.execute(SEED.read_text())
    return conn
