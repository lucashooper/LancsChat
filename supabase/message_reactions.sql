-- LancsChat: reactions table in Supabase (for Realtime subscriptions)
-- Stores per-user emoji reactions keyed by (message_id, user_id, emoji)

create table if not exists public.message_reactions (
  message_id text not null,
  user_id uuid not null default auth.uid(),
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

alter table public.message_reactions enable row level security;

alter table public.message_reactions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'message_reactions'
      and policyname = 'message_reactions_select'
  ) then
    create policy message_reactions_select
      on public.message_reactions
      for select
      using (auth.uid() is not null);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'message_reactions'
      and policyname = 'message_reactions_insert'
  ) then
    create policy message_reactions_insert
      on public.message_reactions
      for insert
      with check (auth.uid() is not null and user_id = auth.uid());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'message_reactions'
      and policyname = 'message_reactions_delete'
  ) then
    create policy message_reactions_delete
      on public.message_reactions
      for delete
      using (auth.uid() is not null and user_id = auth.uid());
  end if;
end $$;

-- Optional guardrail: allow only the 5 emojis used in the UI
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'message_reactions_emoji_check'
  ) then
    alter table public.message_reactions
      add constraint message_reactions_emoji_check
      check (emoji in ('👍', '❤️', '😂', '😮', '😢'));
  end if;
end $$;
