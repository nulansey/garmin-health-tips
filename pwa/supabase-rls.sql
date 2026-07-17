-- Owner-only access. Gated on the SPECIFIC uid, not merely authenticated,
-- so a stranger who signs up still reads nothing. Also disable new signups
-- in the dashboard (Authentication -> Providers -> Email -> "Allow new
-- users to sign up" = off) after the owner's user exists. Run in the SQL
-- editor.

create policy "owner reads daily_metrics"
  on daily_metrics for select
  using (auth.uid() = '3ddda5ba-7228-483f-bcc7-1404eab54a2e');

create policy "owner reads weights"
  on weights for select
  using (auth.uid() = '3ddda5ba-7228-483f-bcc7-1404eab54a2e');

create policy "owner inserts weights"
  on weights for insert
  with check (auth.uid() = '3ddda5ba-7228-483f-bcc7-1404eab54a2e');
