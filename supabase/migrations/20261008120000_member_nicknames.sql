BEGIN;

ALTER TABLE public.member_profiles ADD COLUMN nickname text;
UPDATE public.member_profiles
SET nickname = '회원_' || left(replace(id::text, '-', ''), 16)
WHERE nickname IS NULL;
ALTER TABLE public.member_profiles ALTER COLUMN nickname SET NOT NULL;
ALTER TABLE public.member_profiles
  ADD CONSTRAINT member_profiles_nickname_format
  CHECK (nickname ~ '^[가-힣A-Za-z0-9_]{2,20}$');
CREATE UNIQUE INDEX member_profiles_nickname_unique ON public.member_profiles (lower(nickname));

-- New email and OAuth profiles receive a private, non-login display name by default.
CREATE OR REPLACE FUNCTION public.create_member_profile()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(new.raw_app_meta_data ->> 'provider', 'email') IN ('google', 'kakao') THEN
    RETURN new;
  END IF;
  INSERT INTO public.member_profiles (id, username, nickname, phone)
  VALUES (new.id, trim(new.raw_user_meta_data ->> 'username'),
    '회원_' || left(replace(new.id::text, '-', ''), 16), new.raw_user_meta_data ->> 'phone');
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION public.create_member_profile() FROM public, anon, authenticated;

-- OAuth users who complete profile setup also receive the same default display name.
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
  INSERT INTO public.member_profiles (id, username, nickname, phone)
  VALUES (member_id, requested_username,
    '회원_' || left(replace(member_id::text, '-', ''), 16), requested_phone)
  ON CONFLICT (id) DO NOTHING;
  SELECT username INTO saved_username FROM public.member_profiles WHERE id = member_id;
  RETURN saved_username;
END;
$$;
REVOKE ALL ON FUNCTION public.complete_member_profile(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_member_profile(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_member_nickname(requested_nickname text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE member_id uuid := auth.uid(); normalized text := btrim(requested_nickname);
BEGIN
  IF member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF normalized IS NULL OR normalized !~ '^[가-힣A-Za-z0-9_]{2,20}$' THEN
    RAISE EXCEPTION 'Invalid nickname' USING ERRCODE = '22023';
  END IF;
  UPDATE public.member_profiles SET nickname = normalized WHERE id = member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member profile not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN normalized;
END;
$$;
REVOKE ALL ON FUNCTION public.update_member_nickname(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_member_nickname(text) TO authenticated;

COMMIT;
