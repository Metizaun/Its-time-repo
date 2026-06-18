-- Fix the trigger to check the stage field instead of status
DROP TRIGGER IF EXISTS trigger_notify_deal_won ON public.deals;

-- Update the function to check stage instead of status
CREATE OR REPLACE FUNCTION notify_deal_won() RETURNS TRIGGER AS $$
BEGIN
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
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Recreate the trigger
CREATE TRIGGER trigger_notify_deal_won
AFTER UPDATE ON public.deals
FOR EACH ROW
EXECUTE FUNCTION notify_deal_won();