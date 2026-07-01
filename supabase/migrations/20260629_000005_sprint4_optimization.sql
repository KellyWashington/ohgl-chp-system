-- Sprint 4 Database optimizations
-- Adds indexing for the notifications table queries

create index if not exists idx_notifications_recipient_created on notifications(user_id, created_at desc);
create index if not exists idx_notifications_facility_created on notifications(facility_id, created_at desc) where user_id is null;
