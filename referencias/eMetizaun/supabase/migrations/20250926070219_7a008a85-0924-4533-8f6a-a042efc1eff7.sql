-- Add personal information fields to contacts table
ALTER TABLE public.contacts 
ADD COLUMN birthday date,
ADD COLUMN anniversary date,
ADD COLUMN personal_notes text,
ADD COLUMN important_dates jsonb;