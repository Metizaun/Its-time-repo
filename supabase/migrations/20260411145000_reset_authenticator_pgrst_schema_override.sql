-- Permite que a configuracao remota de API controle os schemas expostos
ALTER ROLE authenticator RESET pgrst.db_schemas;
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
