-- Drop the existing trigger
DROP TRIGGER IF EXISTS trigger_notify_task_assigned ON public.tasks;

-- Update the notification function to be more precise about when to notify
CREATE OR REPLACE FUNCTION public.notify_task_assigned()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Add a log message for debugging
  RAISE NOTICE 'Task trigger fired: TG_OP = %, old assigned_to = %, new assigned_to = %', 
    TG_OP,
    CASE WHEN TG_OP = 'UPDATE' THEN COALESCE(OLD.assigned_to::text, 'NULL') ELSE 'N/A' END,
    COALESCE(NEW.assigned_to::text, 'NULL');
    
  -- Only notify in these specific cases:
  -- 1. INSERT with assigned_to set
  -- 2. UPDATE where assigned_to actually changed
  IF (TG_OP = 'INSERT' AND NEW.assigned_to IS NOT NULL) OR 
     (TG_OP = 'UPDATE' AND OLD.assigned_to IS DISTINCT FROM NEW.assigned_to AND NEW.assigned_to IS NOT NULL) THEN
    
    RAISE NOTICE 'Creating notification for user % about task %', NEW.assigned_to, NEW.title;
    
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
      NEW.assigned_to,
      NEW.organization_id,
      'New Task Assigned',
      'You have been assigned a new task: "' || NEW.title || '"',
      'task_assigned',
      'info',
      '/tasks',
      jsonb_build_object(
        'task_id', NEW.id,
        'task_title', NEW.title,
        'assigned_by', NEW.user_id
      )
    );
    
    RAISE NOTICE 'Notification created successfully';
  ELSE
    RAISE NOTICE 'No notification needed - conditions not met';
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate the trigger with both INSERT and UPDATE, but the function now handles the logic properly
CREATE TRIGGER trigger_notify_task_assigned
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assigned();