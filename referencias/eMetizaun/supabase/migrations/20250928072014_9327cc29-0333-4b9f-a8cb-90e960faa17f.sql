-- Create the deal status notification function
CREATE OR REPLACE FUNCTION public.notify_deal_status_changed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Check if stage changed to Closed Won
  IF NEW.stage = 'Closed Won' AND (OLD.stage IS NULL OR OLD.stage != 'Closed Won') THEN
    -- Notify the deal owner
    INSERT INTO public.notifications (
      user_id,
      organization_id,
      title,
      message,
      type,
      severity,
      action_url,
      metadata
    ) VALUES (
      NEW.user_id,
      NEW.organization_id,
      'Deal Won! 🎉',
      'Congratulations! Your deal "' || NEW.title || '" has been closed successfully.',
      'deal_won',
      'success',
      '/deals',
      jsonb_build_object(
        'deal_id', NEW.id,
        'deal_title', NEW.title,
        'deal_value', NEW.value
      )
    );
    
    -- Notify all other team members in the organization
    INSERT INTO public.notifications (
      user_id,
      organization_id,
      title,
      message,
      type,
      severity,
      action_url,
      metadata
    )
    SELECT 
      ur.user_id,
      NEW.organization_id,
      'Team Deal Won! 🎉',
      'Your team member won deal "' || NEW.title || '"',
      'deal_won',
      'success',
      '/deals',
      jsonb_build_object(
        'deal_id', NEW.id,
        'deal_title', NEW.title,
        'deal_value', NEW.value,
        'won_by', NEW.user_id
      )
    FROM user_roles ur
    WHERE ur.organization_id = NEW.organization_id
    AND ur.user_id != NEW.user_id;
  END IF;
  
  -- Check if stage changed to Closed Lost
  IF NEW.stage = 'Closed Lost' AND (OLD.stage IS NULL OR OLD.stage != 'Closed Lost') THEN
    -- Notify the deal owner
    INSERT INTO public.notifications (
      user_id,
      organization_id,
      title,
      message,
      type,
      severity,
      action_url,
      metadata
    ) VALUES (
      NEW.user_id,
      NEW.organization_id,
      'Deal Lost',
      'Your deal "' || NEW.title || '" has been marked as closed lost.',
      'deal_lost',
      'warning',
      '/deals',
      jsonb_build_object(
        'deal_id', NEW.id,
        'deal_title', NEW.title,
        'deal_value', NEW.value
      )
    );
    
    -- Notify all other team members in the organization
    INSERT INTO public.notifications (
      user_id,
      organization_id,
      title,
      message,
      type,
      severity,
      action_url,
      metadata
    )
    SELECT 
      ur.user_id,
      NEW.organization_id,
      'Team Deal Lost',
      'Deal "' || NEW.title || '" was marked as closed lost',
      'deal_lost',
      'warning',
      '/deals',
      jsonb_build_object(
        'deal_id', NEW.id,
        'deal_title', NEW.title,
        'deal_value', NEW.value,
        'lost_by', NEW.user_id
      )
    FROM user_roles ur
    WHERE ur.organization_id = NEW.organization_id
    AND ur.user_id != NEW.user_id;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Create the trigger for deal status changes
CREATE TRIGGER deal_status_update
  AFTER UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_deal_status_changed();