-- One-row settings table: the shared source of truth for the calorie goal,
-- tip timing, and weight goal (PWA edits it; the Python pipeline reads it).
-- Run in the Supabase SQL editor.

create table settings (
  id int primary key default 1,
  goal_type text not null check (goal_type in ('deficit','maintain','surplus')),
  goal_amount int not null,
  weight_goal_lb numeric not null,
  slots jsonb not null,
  updated_at timestamptz default now()
);

-- Seed the single row from the current config.yaml values + the chart's 155 lb.
insert into settings (id, goal_type, goal_amount, weight_goal_lb, slots) values (
  1, 'deficit', 500, 155,
  '{"morning":{"enabled":true,"hour":7},"midday":{"enabled":true,"hour":13},"evening":{"enabled":true,"hour":20}}'
);

alter table settings enable row level security;

create policy "owner reads settings"
  on settings for select
  using (auth.uid() = '3ddda5ba-7228-483f-bcc7-1404eab54a2e');

create policy "owner updates settings"
  on settings for update
  using (auth.uid() = '3ddda5ba-7228-483f-bcc7-1404eab54a2e')
  with check (auth.uid() = '3ddda5ba-7228-483f-bcc7-1404eab54a2e');
