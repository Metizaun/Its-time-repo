-- Fix security issues by adding search_path to functions
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_organization_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_type TEXT,
  p_severity TEXT DEFAULT 'info',
  p_action_url TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  v_notification_id UUID;
BEGIN
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
    p_user_id,
    p_organization_id,
    p_title,
    p_message,
    p_type,
    p_severity,
    p_action_url,
    p_metadata
  ) RETURNING id INTO v_notification_id;
  
  RETURN v_notification_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Fix trigger functions
CREATE OR REPLACE FUNCTION notify_deal_won() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Closed Won' AND OLD.status != 'Closed Won' THEN
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

CREATE OR REPLACE FUNCTION notify_task_assigned() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL AND (OLD.assigned_to IS NULL OR OLD.assigned_to != NEW.assigned_to) THEN
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
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;