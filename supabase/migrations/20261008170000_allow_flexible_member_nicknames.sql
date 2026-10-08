BEGIN;

ALTER TABLE public.member_profiles
  DROP CONSTRAINT member_profiles_nickname_format;

ALTER TABLE public.member_profiles
  ADD CONSTRAINT member_profiles_nickname_format
  CHECK (
    nickname = btrim(nickname)
    AND char_length(nickname) BETWEEN 1 AND 40
    AND nickname !~ '[[:cntrl:]]'
  );

CREATE OR REPLACE FUNCTION public.update_member_nickname(requested_nickname text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE member_id uuid := auth.uid(); normalized text := btrim(requested_nickname);
BEGIN
  IF member_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF normalized IS NULL OR char_length(normalized) NOT BETWEEN 1 AND 40
     OR normalized ~ '[[:cntrl:]]' THEN
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
