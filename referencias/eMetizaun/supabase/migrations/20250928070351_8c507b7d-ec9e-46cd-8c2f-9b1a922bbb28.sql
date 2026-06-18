-- Remove duplicate task assignment trigger to prevent double notifications
DROP TRIGGER IF EXISTS tasks_assignment_trigger ON public.tasks;