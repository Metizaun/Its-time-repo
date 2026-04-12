-- Remove recursao de RLS no schema crm usando funcoes helper SECURITY DEFINER

DROP POLICY IF EXISTS leads_select ON crm.leads;
CREATE POLICY leads_select ON crm.leads FOR SELECT
  USING (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS leads_insert ON crm.leads;
CREATE POLICY leads_insert ON crm.leads FOR INSERT
  WITH CHECK (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS leads_update ON crm.leads;
CREATE POLICY leads_update ON crm.leads FOR UPDATE
  USING (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS leads_delete ON crm.leads;
CREATE POLICY leads_delete ON crm.leads FOR DELETE
  USING (
    aces_id = public.current_aces_id()
    AND public.current_crm_role() = 'ADMIN'
  );

DROP POLICY IF EXISTS users_select ON crm.users;
CREATE POLICY users_select ON crm.users FOR SELECT
  USING (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS users_update ON crm.users;
CREATE POLICY users_update ON crm.users FOR UPDATE
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS msg_select ON crm.message_history;
CREATE POLICY msg_select ON crm.message_history FOR SELECT
  USING (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS msg_insert ON crm.message_history;
CREATE POLICY msg_insert ON crm.message_history FOR INSERT
  WITH CHECK (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS ps_select ON crm.pipeline_stages;
CREATE POLICY ps_select ON crm.pipeline_stages FOR SELECT
  USING (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS ps_insert ON crm.pipeline_stages;
CREATE POLICY ps_insert ON crm.pipeline_stages FOR INSERT
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND public.current_crm_role() = 'ADMIN'
  );

DROP POLICY IF EXISTS ps_update ON crm.pipeline_stages;
CREATE POLICY ps_update ON crm.pipeline_stages FOR UPDATE
  USING (
    aces_id = public.current_aces_id()
    AND public.current_crm_role() = 'ADMIN'
  );

DROP POLICY IF EXISTS ps_delete ON crm.pipeline_stages;
CREATE POLICY ps_delete ON crm.pipeline_stages FOR DELETE
  USING (
    aces_id = public.current_aces_id()
    AND public.current_crm_role() = 'ADMIN'
  );

DROP POLICY IF EXISTS tags_all ON crm.tags;
CREATE POLICY tags_all ON crm.tags FOR ALL
  USING (aces_id = public.current_aces_id())
  WITH CHECK (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS lead_tags_all ON crm.lead_tags;
CREATE POLICY lead_tags_all ON crm.lead_tags FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM crm.leads l
      WHERE l.id = lead_tags.lead_id
        AND l.aces_id = public.current_aces_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM crm.leads l
      WHERE l.id = lead_tags.lead_id
        AND l.aces_id = public.current_aces_id()
    )
  );

DROP POLICY IF EXISTS opp_all ON crm.opportunities;
CREATE POLICY opp_all ON crm.opportunities FOR ALL
  USING (aces_id = public.current_aces_id())
  WITH CHECK (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS tasks_all ON crm.follow_up_tasks;
CREATE POLICY tasks_all ON crm.follow_up_tasks FOR ALL
  USING (aces_id = public.current_aces_id())
  WITH CHECK (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS accounts_select ON crm.accounts;
CREATE POLICY accounts_select ON crm.accounts FOR SELECT
  USING (id = public.current_aces_id());

DROP POLICY IF EXISTS instance_select ON crm.instance;
CREATE POLICY instance_select ON crm.instance FOR SELECT
  USING (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS inv_select ON crm.user_invitations;
CREATE POLICY inv_select ON crm.user_invitations FOR SELECT
  USING (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS inv_insert ON crm.user_invitations;
CREATE POLICY inv_insert ON crm.user_invitations FOR INSERT
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND public.current_crm_role() = 'ADMIN'
  );
