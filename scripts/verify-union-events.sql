-- Execute the WHOLE script. Synthetic posts are rolled back; no source or AI calls.
-- This checks the database contract, not deployment, authentication or providers.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
DO $check$
DECLARE
  prefix text := 'roc-union-check-' || gen_random_uuid()::text;
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  day_start timestamp := date_trunc('day', clock_timestamp() AT TIME ZONE 'Europe/London');
  window_end bigint;
  second_day bigint;
  eighth_day bigint;
  found_count integer;
  changed integer;
  saved_role text := current_user;
  role_name text;
BEGIN
  window_end := floor(extract(epoch FROM ((day_start + interval '14 days') AT TIME ZONE 'Europe/London')) * 1000)::bigint;
  second_day := floor(extract(epoch FROM ((day_start + interval '2 days 12 hours') AT TIME ZONE 'Europe/London')) * 1000)::bigint;
  eighth_day := floor(extract(epoch FROM ((day_start + interval '8 days 12 hours') AT TIME ZONE 'Europe/London')) * 1000)::bigint;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.posts'::regclass AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'Review unexpected application triggers before inserting rollback fixtures';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('posts','freebie_scans','freebie_tasks','freebie_worker','freebie_venues') AND NOT c.relrowsecurity)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename IN ('posts','freebie_scans','freebie_tasks','freebie_worker','freebie_venues')) THEN
    RAISE EXCEPTION 'Expected server-only tables with enabled RLS and no client policies';
  END IF;
  BEGIN
    INSERT INTO public.posts (id,user_id,type,title,description,location,lat,lng,starts_at,expires_at,source_event_key,source_url,freebie_json,dietary,status,created_at)
    SELECT prefix || '-' || state,'system:union',kind,'Synthetic rollback fixture','Not a real event','Location not stated',NULL,NULL,starts,ends,
      CASE WHEN state='manual' THEN NULL ELSE prefix || ':' || state END,
      'https://studentsunionucl.org/whats-on/clubs-societies/' || prefix,
      CASE WHEN kind='freebie' THEN '{"hasFreebies":true,"freebies":[{"item":"Example sticker","category":"merch","certainty":"confirmed","evidence":"Explicit fixture offer"}],"admission":"paid"}'
        ELSE '{"hasFreebies":false,"freebies":[],"admission":"unknown"}' END,
      '[]',publication,now_ms
    FROM (VALUES
      ('running','event',now_ms-3600000,now_ms+3600000,'approved'),
      ('future','event',second_day,second_day+3600000,'approved'),
      ('offer','freebie',eighth_day,eighth_day+3600000,'approved'),
      ('boundary','event',window_end,window_end+3600000,'approved'),
      ('expired','event',now_ms-7200000,now_ms-1,'approved'),
      ('pending','event',second_day,second_day+3600000,'pending'),
      ('hidden','event',second_day,second_day+3600000,'hidden'),
      ('unknown-start','event',NULL::bigint,second_day+3600000,'approved'),
      ('manual','freebie',second_day,second_day+3600000,'approved')
    ) fixtures(state,kind,starts,ends,publication);

    -- Same source page can have several distinct occurrences, but never duplicate identities.
    BEGIN
      INSERT INTO public.posts (id,user_id,type,title,description,location,expires_at,source_event_key,dietary,status,created_at)
      VALUES (prefix || '-duplicate','system:union','event','Fixture','Fixture','TBC',second_day,prefix || ':future','[]','approved',now_ms);
      RAISE EXCEPTION 'Duplicate occurrence was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    BEGIN
      INSERT INTO public.posts (id,user_id,type,title,description,location,expires_at,source_url,dietary,status,created_at)
      VALUES (prefix || '-duplicate-manual','system:union','freebie','Fixture','Fixture','TBC',second_day,'https://studentsunionucl.org/whats-on/clubs-societies/' || prefix,'[]','approved',now_ms);
      RAISE EXCEPTION 'Duplicate manual source URL was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id=prefix || '-future' AND type='event' AND lat IS NULL AND lng IS NULL AND freebie_json::jsonb->>'hasFreebies'='false' AND freebie_json::jsonb->'freebies'='[]'::jsonb)
       OR NOT EXISTS (SELECT 1 FROM public.posts WHERE id=prefix || '-offer' AND type='freebie' AND freebie_json::jsonb->>'hasFreebies'='true' AND freebie_json::jsonb->>'admission'='paid') THEN
      RAISE EXCEPTION 'Event/freebie metadata or unknown location was lost';
    END IF;
    -- Public-feed predicate, including running events and exclusive London end boundary.
    SELECT count(*) INTO found_count FROM public.posts WHERE id LIKE prefix || '-%'
      AND type IN ('event','freebie') AND source_event_key IS NOT NULL AND status='approved' AND expires_at>now_ms AND starts_at<window_end;
    IF found_count<>3 THEN RAISE EXCEPTION 'Fourteen-day feed visibility failed: %',found_count; END IF;
    SELECT count(*) INTO found_count FROM public.posts WHERE id LIKE prefix || '-%'
      AND type='event' AND source_event_key IS NOT NULL AND status='approved' AND expires_at>now_ms AND starts_at<window_end;
    IF found_count<>2 THEN RAISE EXCEPTION 'Event-only feed includes the wrong records'; END IF;
    SELECT count(*) INTO found_count FROM public.posts WHERE id LIKE prefix || '-%'
      AND type='freebie' AND source_event_key IS NOT NULL AND status='approved' AND expires_at>now_ms AND starts_at<window_end;
    IF found_count<>1 THEN RAISE EXCEPTION 'Freebie-only feed includes the wrong records'; END IF;

    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION 'Client role unexpectedly bypasses RLS';
      END IF;
      EXECUTE format('SET LOCAL ROLE %I',role_name);
      BEGIN
        SELECT count(*) INTO found_count FROM public.posts WHERE id LIKE prefix || '-%';
        IF found_count<>0 THEN RAISE EXCEPTION 'Client role can read application records'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      BEGIN
        UPDATE public.posts SET title='Must not update' WHERE id LIKE prefix || '-%';
        GET DIAGNOSTICS changed = ROW_COUNT;
        IF changed<>0 THEN RAISE EXCEPTION 'Client role can change application records'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      EXECUTE format('SET LOCAL ROLE %I',saved_role);
    END LOOP;
    RAISE EXCEPTION USING ERRCODE='ZX002',MESSAGE='Checks passed; roll back every fixture';
  EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.posts WHERE id LIKE prefix || '-%') THEN
    RAISE EXCEPTION 'Synthetic fixtures were retained';
  END IF;
END
$check$;
ROLLBACK;
SELECT 'PASS: event/freebie metadata, nullable locations, source identity uniqueness, manual-source dedup, fourteen-day feed boundaries, client-role isolation, zero retained fixtures' AS verification;
