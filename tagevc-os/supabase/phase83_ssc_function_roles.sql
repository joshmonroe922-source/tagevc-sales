-- Phase 83: Shared Services function roles for Role Switcher / profiles.
-- Impersonation uses app cookie + APP_ROLES; enum values needed for real profile assignment.

alter type public.app_role add value if not exists 'ssc_finance';
alter type public.app_role add value if not exists 'ssc_hr';
alter type public.app_role add value if not exists 'ssc_legal';
alter type public.app_role add value if not exists 'ssc_it';
alter type public.app_role add value if not exists 'ssc_marketing';
