-- Initial products. Safe to re-run: existing names are left untouched.
insert into public.products (name, price, stock) values
  ('Notebook',     50.00, 10),
  ('Pen',          20.00, 25),
  ('Pencil',       10.00, 30),
  ('Eraser',        5.00, 40),
  ('Geometry Box', 150.00, 5)
on conflict (name) do nothing;
