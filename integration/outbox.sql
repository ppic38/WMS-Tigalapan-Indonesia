-- Review with the Mini ERP administrator before execution.
-- No changes to existing business tables. This is an outbox, not a Moka/ERP writer.
begin;
create table if not exists public.wms_integration_outbox (
 id text primary key,
 target text not null check (target in ('MINI_ERP','MOKA')),
 event text not null,
 payload jsonb not null,
 source_created_at timestamptz,
 received_at timestamptz not null default now(),
 status text not null default 'QUEUED' check (status in ('QUEUED','APPLIED','FAILED')),
 external_id text,
 applied_at timestamptz,
 last_error text,
 constraint applied_requires_evidence check (status <> 'APPLIED' or (external_id is not null and length(external_id)>0 and applied_at is not null))
);
alter table public.wms_integration_outbox enable row level security;
revoke all on public.wms_integration_outbox from anon, authenticated;
grant select,insert,update on public.wms_integration_outbox to service_role;
create or replace function public.wms_integration_event(p_action text,p_event jsonb)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare row_data public.wms_integration_outbox; event_id text := p_event->>'id';
begin
 if event_id is null or event_id !~ '^[a-zA-Z0-9_-]{1,100}$' or p_action not in ('submit','status') then raise exception 'Invalid request'; end if;
 if p_action='submit' then
  if (p_event->>'target') not in ('MINI_ERP','MOKA') or jsonb_typeof(p_event->'payload')<>'object' then raise exception 'Invalid event'; end if;
  insert into public.wms_integration_outbox(id,target,event,payload,source_created_at)
  values(event_id,p_event->>'target',p_event->>'event',p_event->'payload',(p_event->>'createdAt')::timestamptz)
  on conflict(id) do nothing;
 end if;
 select * into row_data from public.wms_integration_outbox where id=event_id;
 if not found then return jsonb_build_object('id',event_id,'status','NOT_FOUND'); end if;
 if row_data.target is distinct from p_event->>'target' or row_data.event is distinct from p_event->>'event' or row_data.payload is distinct from p_event->'payload' then raise exception 'Event ID already belongs to a different payload'; end if;
 return jsonb_build_object('id',event_id,'status',row_data.status,'externalId',row_data.external_id);
end;
$$;
revoke all on function public.wms_integration_event(text,jsonb) from public,anon,authenticated;
grant execute on function public.wms_integration_event(text,jsonb) to service_role;
commit;
