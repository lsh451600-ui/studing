BEGIN;
-- Password signups keep requiring both fields. OAuth users complete their profile after login.
CREATE OR REPLACE FUNCTION public.create_member_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(new.raw_app_meta_data ->> 'provider', 'email') IN ('google', 'kakao') THEN
    RETURN new;
  END IF;
  INSERT INTO public.member_profiles (id, username, phone)
  VALUES (new.id, trim(new.raw_user_meta_data ->> 'username'), new.raw_user_meta_data ->> 'phone');
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.create_member_profile() FROM public, anon, authenticated;

-- A user can create only their own initial profile; an existing profile is preserved.
CREATE OR REPLACE FUNCTION public.complete_member_profile(requested_username text, requested_phone text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE member_id uuid := auth.uid(); saved_username text;
BEGIN
  IF member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT username INTO saved_username FROM public.member_profiles WHERE id = member_id;
  IF FOUND THEN RETURN saved_username; END IF;
  IF requested_username IS NULL OR requested_username !~ '^[A-Za-z0-9_]{4,20}$'
     OR requested_phone IS NULL OR requested_phone !~ '^\+?[0-9]{9,15}$' THEN
    RAISE EXCEPTION 'Invalid profile' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.member_profiles (id, username, phone)
  VALUES (member_id, requested_username, requested_phone)
  ON CONFLICT (id) DO NOTHING;
  SELECT username INTO saved_username FROM public.member_profiles WHERE id = member_id;
  RETURN saved_username;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_member_profile(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_member_profile(text, text) TO authenticated;
COMMIT;
