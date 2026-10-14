-- Hosted smoke check: synthetic application posts/votes only, no Auth/profile data.
-- Execute this WHOLE script once. Every fixture is rolled back even on success.
-- Application authentication, Claude, HTTP and Storage remain separate checks.
BEGIN;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '2s';
DO $check$
DECLARE
  prefix text := 'rmc-check-' || gen_random_uuid()::text;
  owner_id text;
  post_id text;
  manual_id text;
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  threshold_ms bigint;
  changed integer;
  found_count integer;
  actual public.posts%ROWTYPE;
  saved_role text := current_user;
  role_name text;
  vote_no integer;
BEGIN
  owner_id := prefix || '-owner';
  post_id := prefix || '-active';
  manual_id := prefix || '-manual';
  threshold_ms := now_ms - 30 * 60000;
  -- A project-specific webhook could have effects outside the SQL transaction.
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.posts'::regclass, 'public.votes'::regclass) AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'Unexpected application trigger: review it before inserting rollback fixtures';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('posts','votes') AND NOT c.relrowsecurity)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('posts','votes')) THEN
    RAISE EXCEPTION 'Expected enabled RLS with no public application policies';
  END IF;

  -- The inner subtransaction also rolls back fixtures before the outer ROLLBACK.
  BEGIN
    INSERT INTO public.posts (id,user_id,type,title,description,location,lat,lng,expires_at,starts_at,dietary,status,created_at,collection_instructions,portions_remaining,food_details,availability_updated_at,closed_at,closure_reason)
    SELECT prefix || '-' || state, owner_id, CASE WHEN state = 'deal' THEN 'deal' ELSE 'food' END,
      'Rollback-only backend check', 'Synthetic fixture', 'Synthetic test location', 51.524, -0.134,
      CASE WHEN state = 'expired' THEN now_ms - 1 ELSE now_ms + 3600000 END,
      CASE WHEN state = 'future' THEN now_ms + 60000 ELSE NULL END, '[]',
      CASE WHEN state IN ('pending','hidden') THEN state ELSE 'approved' END,
      now_ms - 2400000, 'Rollback-only pickup instructions', CASE WHEN state = 'zero' THEN 0 ELSE 4 END,
      '{"allergenStatus":"unknown","allergens":[],"ingredients":"","handling":"","sourceLabel":"","pickupAccess":"ask","bringContainer":false}',
      now_ms - 600000, CASE WHEN state = 'closed' THEN now_ms - 1000 ELSE NULL END,
      CASE WHEN state = 'closed' THEN 'ended' ELSE NULL END
    FROM unnest(ARRAY['active','pending','hidden','expired','zero','future','closed','deal']) state;

    -- Same active predicate as GET /community/food; only synthetic rows are read.
    SELECT count(*) INTO found_count FROM public.posts WHERE id LIKE prefix || '-%'
      AND type = 'food' AND status = 'approved' AND expires_at > now_ms
      AND (starts_at IS NULL OR starts_at <= now_ms) AND closed_at IS NULL
      AND (portions_remaining IS NULL OR portions_remaining > 0);
    IF found_count <> 1 THEN RAISE EXCEPTION 'Food feed filtering failed'; END IF;
    SELECT * INTO actual FROM public.posts WHERE id = post_id;
    IF actual.food_details::jsonb ->> 'allergenStatus' <> 'unknown' OR actual.collection_instructions <> 'Rollback-only pickup instructions' THEN
      RAISE EXCEPTION 'Food metadata roundtrip failed';
    END IF;

    -- Same CAS predicate as food-availability: wrong owner cannot update.
    UPDATE public.posts SET portions_remaining = 3, availability_updated_at = now_ms, moderation_revision = moderation_revision + 1
      WHERE id = post_id AND user_id = prefix || '-other' AND type = 'food' AND status = 'approved' AND expires_at > now_ms
      AND (starts_at IS NULL OR starts_at <= now_ms) AND closed_at IS NULL AND moderation_revision = 0;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 0 THEN RAISE EXCEPTION 'Wrong-owner update succeeded'; END IF;
    UPDATE public.posts SET portions_remaining = 3, availability_updated_at = now_ms - 600000, moderation_revision = moderation_revision + 1,
      expires_at = CASE WHEN 3 = 0 THEN LEAST(expires_at, now_ms) ELSE expires_at END,
      closure_reason = CASE WHEN 3 = 0 THEN 'collected' ELSE closure_reason END,
      closed_at = CASE WHEN 3 = 0 THEN now_ms ELSE closed_at END
      WHERE id = post_id AND user_id = owner_id AND type = 'food' AND status = 'approved' AND expires_at > now_ms
      AND (starts_at IS NULL OR starts_at <= now_ms) AND closed_at IS NULL AND moderation_revision = 0;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN RAISE EXCEPTION 'Owner CAS update failed'; END IF;
    UPDATE public.posts SET portions_remaining = 9, moderation_revision = moderation_revision + 1
      WHERE id = post_id AND user_id = owner_id AND type = 'food' AND status = 'approved' AND expires_at > now_ms
      AND (starts_at IS NULL OR starts_at <= now_ms) AND closed_at IS NULL AND moderation_revision = 0;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 0 THEN RAISE EXCEPTION 'Stale revision update succeeded'; END IF;

    -- Owner, old and pre-confirmation votes must not count as fresh feedback.
    INSERT INTO public.votes(id,user_id,target_id,kind,created_at) VALUES
      (prefix || '-owner-vote',owner_id,post_id,'gone',now_ms),
      (prefix || '-old-vote',prefix || '-old-user',post_id,'gone',threshold_ms - 1),
      (prefix || '-pre-vote',prefix || '-pre-user',post_id,'gone',now_ms - 600001),
      (prefix || '-still-vote',prefix || '-still-user',post_id,'still',now_ms - 1000);
    FOR vote_no IN 1..3 LOOP
      -- Same locking/upsert shape as the availability vote transaction.
      INSERT INTO public.votes (id,user_id,target_id,kind,created_at)
        SELECT prefix || '-vote-' || vote_no, prefix || '-voter-' || vote_no, p.id, 'gone', now_ms
        FROM public.posts p WHERE p.id = post_id AND p.type = 'food' AND p.status = 'approved' AND p.expires_at > now_ms
        AND (p.starts_at IS NULL OR p.starts_at <= now_ms) AND p.closed_at IS NULL AND p.user_id <> prefix || '-voter-' || vote_no
        FOR UPDATE OF p ON CONFLICT(user_id,target_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at;
      -- Repeating one account cannot increase its count.
      INSERT INTO public.votes (id,user_id,target_id,kind,created_at)
        VALUES(prefix || '-repeat-' || vote_no,prefix || '-voter-' || vote_no,post_id,'gone',now_ms)
        ON CONFLICT(user_id,target_id) DO UPDATE SET kind = excluded.kind, created_at = excluded.created_at;
      SELECT count(*) INTO found_count FROM public.votes v JOIN public.posts p ON p.id = v.target_id
        WHERE p.id = post_id AND v.kind = 'gone' AND v.user_id <> p.user_id
        AND v.created_at > GREATEST(threshold_ms, COALESCE(p.availability_updated_at,p.created_at));
      IF found_count <> vote_no THEN RAISE EXCEPTION 'Feedback freshness or uniqueness failed'; END IF;
      UPDATE public.posts p SET expires_at = LEAST(p.expires_at,now_ms), closure_reason = 'community-gone', closed_at = now_ms, moderation_revision = moderation_revision + 1
        WHERE p.id = post_id AND p.status = 'approved' AND p.expires_at > now_ms AND p.closed_at IS NULL
        AND (SELECT count(*) FROM public.votes v WHERE v.target_id = p.id AND v.kind = 'gone' AND v.user_id <> p.user_id AND v.created_at > GREATEST(threshold_ms,COALESCE(p.availability_updated_at,p.created_at))) >= 3
        AND (SELECT count(*) FROM public.votes v WHERE v.target_id = p.id AND v.kind = 'gone' AND v.user_id <> p.user_id AND v.created_at > GREATEST(threshold_ms,COALESCE(p.availability_updated_at,p.created_at)))
          > (SELECT count(*) FROM public.votes v WHERE v.target_id = p.id AND v.kind = 'still' AND v.user_id <> p.user_id AND v.created_at > GREATEST(threshold_ms,COALESCE(p.availability_updated_at,p.created_at)));
      GET DIAGNOSTICS changed = ROW_COUNT;
      IF changed <> (CASE WHEN vote_no = 3 THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'Community closure quorum failed'; END IF;
    END LOOP;
    SELECT * INTO actual FROM public.posts WHERE id = post_id;
    IF actual.closure_reason <> 'community-gone' OR actual.closed_at <> now_ms OR actual.expires_at > now_ms OR actual.moderation_revision <> 2 THEN
      RAISE EXCEPTION 'Community closure state failed';
    END IF;

    INSERT INTO public.posts(id,user_id,type,title,description,location,lat,lng,expires_at,dietary,status,created_at,portions_remaining)
      VALUES(manual_id,owner_id,'food','Rollback-only manual closure','Synthetic fixture','Synthetic test location',51.524,-0.134,now_ms + 60000,'[]','approved',now_ms,4);
    -- Same first-close-wins predicate as close-post, with two different reasons.
    UPDATE public.posts SET expires_at = LEAST(expires_at,now_ms),
      portions_remaining = CASE WHEN type = 'food' AND 'withdrawn' = 'collected' THEN 0 ELSE portions_remaining END,
      closure_reason = COALESCE(closure_reason,'withdrawn'), closed_at = COALESCE(closed_at,now_ms),
      availability_updated_at = now_ms, moderation_revision = moderation_revision + 1
      WHERE id = manual_id AND user_id = owner_id AND closed_at IS NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 1 THEN RAISE EXCEPTION 'Owner closure failed'; END IF;
    UPDATE public.posts SET expires_at = LEAST(expires_at,now_ms),
      portions_remaining = CASE WHEN type = 'food' AND 'collected' = 'collected' THEN 0 ELSE portions_remaining END,
      closure_reason = COALESCE(closure_reason,'collected'), closed_at = COALESCE(closed_at,now_ms),
      availability_updated_at = now_ms, moderation_revision = moderation_revision + 1
      WHERE id = manual_id AND user_id = owner_id AND closed_at IS NULL;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 0 THEN RAISE EXCEPTION 'Repeated closure modified the first closure'; END IF;
    SELECT * INTO actual FROM public.posts WHERE id = manual_id;
    IF actual.closure_reason <> 'withdrawn' OR actual.portions_remaining <> 4 OR actual.moderation_revision <> 1 THEN
      RAISE EXCEPTION 'First closure was not preserved';
    END IF;

    -- RLS defense in depth: neither client role sees or updates synthetic records.
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name AND (rolsuper OR rolbypassrls)) THEN
        RAISE EXCEPTION 'Client role unexpectedly bypasses RLS';
      END IF;
      EXECUTE format('SET LOCAL ROLE %I',role_name);
      BEGIN
        SELECT count(*) INTO found_count FROM public.posts WHERE id = post_id;
        IF found_count <> 0 THEN RAISE EXCEPTION 'Client role can read a private application row'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL; -- No table grant also denies access.
      END;
      BEGIN
        UPDATE public.posts SET title = 'Client role must not write' WHERE id = post_id;
        GET DIAGNOSTICS changed = ROW_COUNT;
        IF changed <> 0 THEN RAISE EXCEPTION 'Client role can update an application row'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      BEGIN
        SELECT count(*) INTO found_count FROM public.votes WHERE target_id = post_id;
        IF found_count <> 0 THEN RAISE EXCEPTION 'Client role can read private votes'; END IF;
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END;
      EXECUTE format('SET LOCAL ROLE %I',saved_role);
    END LOOP;
    -- The caught dedicated SQLSTATE intentionally rolls back this entire fixture block.
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'Checks passed; roll back synthetic fixtures';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.posts WHERE id LIKE prefix || '-%') OR EXISTS (SELECT 1 FROM public.votes WHERE id LIKE prefix || '-%') THEN
    RAISE EXCEPTION 'Synthetic fixture rollback failed';
  END IF;
END
$check$;
ROLLBACK;
SELECT 'PASS: feed, metadata, ownership/CAS, fresh unique feedback, quorum, idempotent closure, client-role isolation, zero retained fixtures' AS verification;
