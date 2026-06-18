-- Add missing database triggers for task automation

-- Trigger for deals table (deal_created and deal_stage_changed)
CREATE OR REPLACE TRIGGER deals_automation_trigger_insert
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_deal_created();

CREATE OR REPLACE TRIGGER deals_automation_trigger_update
  AFTER UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_deal_stage_changed();

-- Trigger for contacts table (contact_created)
CREATE OR REPLACE TRIGGER contacts_automation_trigger
  AFTER INSERT ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_contact_created();

-- Trigger for companies table (company_created)
CREATE OR REPLACE TRIGGER companies_automation_trigger
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_company_created();

-- Trigger for leads table (lead_converted)
CREATE OR REPLACE TRIGGER leads_automation_trigger
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_lead_status_changed();

-- Trigger for tasks table (task_assigned notifications)
CREATE OR REPLACE TRIGGER tasks_assignment_trigger
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_task_assigned();

-- Trigger for deals table (deal won notifications)
CREATE OR REPLACE TRIGGER deals_won_trigger
  AFTER UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_deal_won();