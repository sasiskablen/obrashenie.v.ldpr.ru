# Supabase setup

## 1. Create project
- Create a project in Supabase.
- Copy `Project URL` and `anon public key`.

## 2. Configure frontend
- Open `js/supabase-config.js`.
- Replace:
  - `url` with your project URL
  - `anonKey` with your anon key

## 3. Create database schema
- Open Supabase -> SQL Editor.
- Run `supabase-schema.sql`.

## 4. Auth settings
- In Auth -> Providers enable Email.
- In Auth -> URL Configuration add your site URL.
- If you want instant login after registration, disable email confirmation.

## 5. Create admin account
1. Register a normal user in the app.
2. In Supabase SQL Editor run:

```sql
update public.profiles
set role = 'admin'
where email = 'your-admin-email@example.com';
```

## 6. Data model used by app
- `profiles`: user public data and role.
- `tickets`: user обращения.
- `messages`: переписка внутри обращения.

## 7. Notes
- Old `localStorage` data is not auto-imported.
- Passwords are now handled by Supabase Auth (secure server-side hashing).
