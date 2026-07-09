update auth.users
set
  email_confirmed_at = coalesce(email_confirmed_at, now()),
  confirmation_token = '',
  updated_at = now()
where id = 'c2047244-294c-40aa-a73c-c7861c46b64c'::uuid
  and lower(email) = lower('marketing@arquem.com.br')
returning
  id,
  email,
  email_confirmed_at,
  updated_at;