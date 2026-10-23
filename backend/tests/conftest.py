import os

# Point settings at a dummy project before anything imports app.core.config, so no test
# can reach the real Supabase project even if backend/.env has real keys.
os.environ["SUPABASE_URL"] = "http://supabase.test.invalid"
os.environ["SUPABASE_SECRET_KEY"] = "test-secret-key"
