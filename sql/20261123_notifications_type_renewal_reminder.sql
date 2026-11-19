-- Migration: Allow 'renewal_reminder' in notifications_type_check
ALTER TABLE public.notifications 
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications 
  ADD CONSTRAINT notifications_type_check 
  CHECK (type IN (
    'assignment_created',
    'assignment_updated',
    'deadline_reminder',
    'submission_success',
    'submission_reviewed',
    'flag_created',
    'grade_published',
    'final_result_released',
    'chat_message',
    'system_announcement',
    'renewal_reminder'
  ));
