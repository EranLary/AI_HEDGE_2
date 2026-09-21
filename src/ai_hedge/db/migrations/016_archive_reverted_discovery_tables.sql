-- Archive tables left behind by the reverted Discovery performance feature.
--
-- Commit 6167492 created these relations at runtime. PR #27 reverted the
-- feature code but intentionally did not delete its data. No current runtime
-- path reads or writes the tables. Move them out of public instead of dropping
-- them so the small historical dataset remains recoverable.

CREATE SCHEMA IF NOT EXISTS archive;

DO $$
DECLARE
    relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'discovery_strategy_nav',
        'discovery_strategy_holdings',
        'discovery_benchmark_nav'
    ]
    LOOP
        IF to_regclass(format('public.%I', relation_name)) IS NOT NULL THEN
            IF to_regclass(format('archive.%I', relation_name)) IS NOT NULL THEN
                RAISE EXCEPTION
                    'cannot archive public.%: archive.% already exists',
                    relation_name,
                    relation_name;
            END IF;

            EXECUTE format(
                'ALTER TABLE public.%I SET SCHEMA archive',
                relation_name
            );
        END IF;
    END LOOP;
END
$$;

COMMENT ON SCHEMA archive IS
    'Recoverable data from retired features; not part of the active application schema.';
