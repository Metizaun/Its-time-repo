UPDATE crm.leads l
SET
  instancia = 'prospect',
  updated_at = now()
WHERE l.aces_id = 1
  AND COALESCE(l.view, TRUE) = TRUE
  AND COALESCE(btrim(l.instancia::text), '') = ''
  AND EXISTS (
    SELECT 1
    FROM crm.instance i
    WHERE i.aces_id = l.aces_id
      AND i.instancia = 'prospect'
      AND lower(COALESCE(i.status, '')) = 'connected'
      AND lower(COALESCE(i.setup_status, '')) = 'connected'
  );
