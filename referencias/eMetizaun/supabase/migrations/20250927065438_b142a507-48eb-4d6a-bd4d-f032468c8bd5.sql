-- Apply notifications table and functions
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT NOT NULL, -- 'deal_update', 'task_reminder', 'mention', 'system', 'lead_assigned', 'deal_won', 'deal_lost', 'task_assigned'
  severity TEXT NOT NULL DEFAULT 'info', -- 'info', 'success', 'warning', 'error'
  read BOOLEAN NOT NULL DEFAULT false,
  action_url TEXT, -- Optional URL to navigate to when clicked
  metadata JSONB, -- Additional data for the notification
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  read_at TIMESTAMP WITH TIME ZONE
);

-- Add assigned_to column to tasks table if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'assigned_to') THEN
    ALTER TABLE public.tasks ADD COLUMN assigned_to UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_organization_id ON public.notifications(organization_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON public.tasks(assigned_to);

-- Enable Row Level Security
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- Create RLS policies for notifications
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can view their own notifications') THEN
    CREATE POLICY "Users can view their own notifications" 
    ON public.notifications 
    FOR SELECT 
    USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'System can create notifications for users') THEN
    CREATE POLICY "System can create notifications for users" 
    ON public.notifications 
    FOR INSERT 
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM user_roles 
        WHERE user_roles.user_id = auth.uid() 
        AND user_roles.organization_id = notifications.organization_id
      )
    );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can update their own notifications') THEN
    CREATE POLICY "Users can update their own notifications" 
    ON public.notifications 
    FOR UPDATE 
    USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notifications' AND policyname = 'Users can delete their own notifications') THEN
    CREATE POLICY "Users can delete their own notifications" 
    ON public.notifications 
    FOR DELETE 
    USING (auth.uid() = user_id);
  END IF;
END $$;

-- Function to create notifications
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create notifications when a deal is won
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
$$ LANGUAGE plpgsql;

-- Create trigger for deal won notifications
DROP TRIGGER IF EXISTS trigger_notify_deal_won ON public.deals;
CREATE TRIGGER trigger_notify_deal_won
AFTER UPDATE ON public.deals
FOR EACH ROW
EXECUTE FUNCTION notify_deal_won();

-- Trigger to create notifications for task assignments
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
$$ LANGUAGE plpgsql;

-- Create trigger for task assignment notifications
DROP TRIGGER IF EXISTS trigger_notify_task_assigned ON public.tasks;
CREATE TRIGGER trigger_notify_task_assigned
AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION notify_task_assigned();

-- Enable realtime for notifications
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notifications') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    -- Table is already in publication, ignore
    NULL;
END $$;