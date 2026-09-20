-- TASK 05 — seed 45 known institutions
--
-- Adapted to the real public.institutions schema (001_initial_schema.sql):
-- there is no plain-text "city" column, only city_code, so the task's
-- source list's city names are dropped and only city_code is kept. The
-- task's trailing boolean ("is_verified = true for pre-seeded institutions")
-- maps to this schema's closest equivalent, is_partner — there is no
-- is_verified column. ON CONFLICT (slug) DO NOTHING makes this migration
-- safe to re-run.
--
-- FIX: the task's source list gave 'IIT Kanpur' the slug 'IITKGP', which
-- collides with 'IIT Kharagpur' immediately above it (slug is UNIQUE) — corrected
-- to 'IITKAN' here so both rows actually get inserted instead of Kanpur
-- silently no-opping against the conflict target.

INSERT INTO public.institutions (name, slug, type, city_code, country_code, email_domain, is_partner) VALUES
  -- Schools — India
  ('MP Birla School', 'MPBIRLA', 'school', 'KOL', 'IN', null, true),
  ('KV Fort William', 'KVFORTW', 'school', 'KOL', 'IN', null, true),
  ('DPS RK Puram', 'DPSRKP', 'school', 'DEL', 'IN', null, true),
  ('DPS Mathura Road', 'DPSMR', 'school', 'DEL', 'IN', null, true),
  ('La Martiniere Boys', 'LAMARB', 'school', 'KOL', 'IN', null, true),
  ('La Martiniere Girls', 'LAMARG', 'school', 'KOL', 'IN', null, true),
  ('St Xaviers Collegiate School', 'SXCSKOL', 'school', 'KOL', 'IN', null, true),
  ('Don Bosco School Kolkata', 'DONBKOL', 'school', 'KOL', 'IN', null, true),
  ('South Point School', 'SPTKOL', 'school', 'KOL', 'IN', null, true),
  ('Loreto House', 'LHKOL', 'school', 'KOL', 'IN', null, true),
  ('Modern High School', 'MHSKOL', 'school', 'KOL', 'IN', null, true),
  ('Doon School', 'DOON', 'school', 'DDN', 'IN', null, true),
  ('Welham Boys School', 'WELHAMB', 'school', 'DDN', 'IN', null, true),
  ('Welham Girls School', 'WELHAMG', 'school', 'DDN', 'IN', null, true),
  ('Mayo College', 'MAYO', 'school', 'AJM', 'IN', null, true),
  ('Scindia School', 'SCINDIA', 'school', 'GWL', 'IN', null, true),
  ('Cathedral School Mumbai', 'CATHMUM', 'school', 'MUM', 'IN', null, true),
  ('Campion School Mumbai', 'CAMPMUM', 'school', 'MUM', 'IN', null, true),
  ('Bishop Cotton School', 'BCOTTON', 'school', 'SML', 'IN', null, true),
  ('Army Public School Delhi', 'APSDEL', 'school', 'DEL', 'IN', null, true),
  ('St Columba School', 'STCOLB', 'school', 'DEL', 'IN', null, true),
  ('Springdales School', 'SPRDEL', 'school', 'DEL', 'IN', null, true),
  ('Frank Anthony Public School', 'FAPSDEL', 'school', 'DEL', 'IN', null, true),
  ('Loreto Convent Entally', 'LCEKOL', 'school', 'KOL', 'IN', null, true),
  ('St James School Kolkata', 'STJKOL', 'school', 'KOL', 'IN', null, true),

  -- Colleges/Universities — India
  ('IIT Kharagpur', 'IITKGP', 'university', null, 'IN', 'kgpian.iitkgp.ac.in', true),
  ('IIT Delhi', 'IITDEL', 'university', null, 'IN', 'iitd.ac.in', true),
  ('IIT Bombay', 'IITBOM', 'university', null, 'IN', 'iitb.ac.in', true),
  ('IIT Madras', 'IITMAD', 'university', null, 'IN', 'iitm.ac.in', true),
  ('IIT Kanpur', 'IITKAN', 'university', null, 'IN', 'iitk.ac.in', true),
  ('IIM Ahmedabad', 'IIMA', 'university', null, 'IN', 'iima.ac.in', true),
  ('IIM Calcutta', 'IIMC', 'university', null, 'IN', 'iimcal.ac.in', true),
  ('IIM Bangalore', 'IIMB', 'university', null, 'IN', 'iimb.ac.in', true),
  ('BITS Pilani', 'BITS', 'university', null, 'IN', 'pilani.bits-pilani.ac.in', true),
  ('Delhi University', 'DU', 'university', null, 'IN', 'du.ac.in', true),
  ('Jadavpur University', 'JADAVPU', 'university', 'KOL', 'IN', null, true),
  ('Presidency University Kolkata', 'PRESKOL', 'university', 'KOL', 'IN', null, true),
  ('VIT Vellore', 'VIT', 'university', null, 'IN', 'vit.ac.in', true),
  ('Manipal Institute of Technology', 'MANIPAL', 'university', null, 'IN', 'manipal.edu', true),
  ('NIT Trichy', 'NITTRY', 'university', null, 'IN', null, true),
  ('Christ University Bangalore', 'CHRISTB', 'university', 'BLR', 'IN', null, true),
  ('Symbiosis Pune', 'SYMPUNE', 'university', 'PNE', 'IN', null, true),
  ('St Stephens College Delhi', 'STSTEPH', 'college', 'DEL', 'IN', null, true),
  ('Calcutta University', 'CALCUTTA', 'university', 'KOL', 'IN', null, true),

  -- International
  ('UC Davis', 'UCDAVIS', 'university', null, 'US', 'ucdavis.edu', true),
  ('MIT', 'MIT', 'university', null, 'US', 'mit.edu', true),
  ('Stanford University', 'STANFORD', 'university', null, 'US', 'stanford.edu', true),
  ('University of Melbourne', 'UMELB', 'university', null, 'AU', 'unimelb.edu.au', true),
  ('University of London', 'ULON', 'university', null, 'GB', null, true)
ON CONFLICT (slug) DO NOTHING;
