-- Update the task notification function to add better debugging and ensure it's working
CREATE OR REPLACE FUNCTION notify_task_assigned() RETURNS TRIGGER AS $$
BEGIN
  -- Add a log message for debugging
  RAISE NOTICE 'Task trigger fired: old assigned_to = %, new assigned_to = %', 
    COALESCE(OLD.assigned_to::text, 'NULL'), 
    COALESCE(NEW.assigned_to::text, 'NULL');
    
  IF NEW.assigned_to IS NOT NULL AND (OLD.assigned_to IS NULL OR OLD.assigned_to != NEW.assigned_to) THEN
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
$$ LANGUAGE plpgsql SET search_path = public;