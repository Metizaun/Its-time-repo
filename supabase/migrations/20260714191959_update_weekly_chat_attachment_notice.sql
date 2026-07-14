-- Extend the already published weekly update without creating a new notification.
DO $$
BEGIN
  UPDATE crm.notifications
  SET description =
    'Mensagens agora chegam em tempo real, com contadores de novas conversas e uma finalizacao mais confiavel. O chat tambem permite enviar arquivos CSV e planilhas XLS ou XLSX.'
  WHERE idempotency_key = 'weekly_update:2026-07-14';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notificacao weekly_update:2026-07-14 nao encontrada';
  END IF;
END;
$$;
