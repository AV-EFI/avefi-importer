-- AVefi Importer — PostgreSQL-Schema
-- Wird von Postgres beim ersten Start automatisch ausgeführt
-- (docker-entrypoint-initdb.d), ausserdem beim Start von Weboberflaeche und
-- Worker (DB_SCHEMA_AUTO). Das erste Konto legt danach `npm run seed` an:
--   docker compose -f docker-compose.dev.yml exec web npm run seed

CREATE TABLE IF NOT EXISTS institutions (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    slug        TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    institution_id  INTEGER REFERENCES institutions(id) ON DELETE SET NULL,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT,
    name            TEXT NOT NULL DEFAULT '',
    is_admin        BOOLEAN NOT NULL DEFAULT false,
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS format_profiles (
    id            SERIAL PRIMARY KEY,
    converter_key TEXT NOT NULL UNIQUE,   -- muss zur hardcoded FingerprintRegistry passen
    label         TEXT NOT NULL,
    base_format   TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    CREATE TYPE import_status AS ENUM
        ('uploading','queued','awaiting_format_review','converting','converted','error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Nachgereicht: Arbeitsmappen mit mehreren Tabellenblättern warten auf die Auswahl,
-- welches Blatt verarbeitet werden soll.
ALTER TYPE import_status ADD VALUE IF NOT EXISTS 'awaiting_sheet_choice';

CREATE TABLE IF NOT EXISTS imports (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),  -- benennt /mnt/files/<id>/
    institution_id     INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    user_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
    filename           TEXT NOT NULL,
    filesize           BIGINT NOT NULL DEFAULT 0,
    base_format        TEXT,                 -- csv/tsv/xml/ead/marcxml/json
    fingerprint        TEXT,
    format_profile_id  INTEGER REFERENCES format_profiles(id),
    status             import_status NOT NULL DEFAULT 'uploading',
    upload_progress    SMALLINT NOT NULL DEFAULT 0,
    record_count       INTEGER NOT NULL DEFAULT 0,
    error_count        INTEGER NOT NULL DEFAULT 0,
    storage_path       TEXT,
    report_json        JSONB,                -- Parse-/Validierungsbericht (Fehlerreport)
    detected_format    TEXT,                 -- erkanntes Format/Schema fürs Badge (z. B. „AVefi (nativ)")
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nachrüst-Spalten für Bestands-DBs (migrate-Bot): CREATE TABLE IF NOT EXISTS legt
-- neue Spalten nicht an, daher hier idempotent per ALTER.
ALTER TABLE imports ADD COLUMN IF NOT EXISTS report_json     JSONB;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS detected_format TEXT;

CREATE TABLE IF NOT EXISTS records (
    id                   SERIAL PRIMARY KEY,
    import_id            UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    work_title           TEXT,
    work_year            INTEGER,
    work_type            TEXT,
    avefi_pid            TEXT,
    manifestation_count  INTEGER NOT NULL DEFAULT 0,
    item_count           INTEGER NOT NULL DEFAULT 0,
    completeness         SMALLINT NOT NULL DEFAULT 0,   -- 0..100
    data_json            JSONB NOT NULL DEFAULT '{}',   -- vollständiges AVefi-Record (Work+Manif.+Items)
    source_row           INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nachrüst-Spalte: markiert von Hand bearbeitete Datensätze. Wird gebraucht, um vor
-- dem Neukonvertieren ehrlich sagen zu können, wie viel Handarbeit verloren geht.
ALTER TABLE records ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS format_reviews (
    id           SERIAL PRIMARY KEY,
    import_id    UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
    fingerprint  TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'open',   -- open/resolved/rejected
    sample_json  JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mapping-Profile: gespeicherte Spaltenzuordnungen je Kopfzeile (header_hash).
-- Global sichtbar; die Auflösung bevorzugt das Profil der eigenen Institution.
-- Getrennt von format_profiles, das die im Code vorhandenen Converter beschreibt.
CREATE TABLE IF NOT EXISTS mapping_profiles (
    id                 SERIAL PRIMARY KEY,
    institution_id     INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    header_hash        TEXT NOT NULL,          -- md5 über normalisierte, sortierte Header + Basisformat
    base_format        TEXT NOT NULL,
    name               TEXT NOT NULL,
    mapping_json       JSONB NOT NULL DEFAULT '{}',
    version            INTEGER NOT NULL DEFAULT 1,
    complete           BOOLEAN NOT NULL DEFAULT false,
    derived_from_id    INTEGER REFERENCES mapping_profiles(id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (institution_id, header_hash)
);

-- Versionsverlauf: ein verunglücktes Mapping soll zurückholbar sein, und ein Import
-- muss belegen können, mit welchem Stand er entstanden ist.
CREATE TABLE IF NOT EXISTS mapping_profile_versions (
    id           SERIAL PRIMARY KEY,
    profile_id   INTEGER NOT NULL REFERENCES mapping_profiles(id) ON DELETE CASCADE,
    version      INTEGER NOT NULL,
    name         TEXT NOT NULL DEFAULT '',
    mapping_json JSONB NOT NULL,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (profile_id, version)
);

-- Normdaten-Cache: Kulturdaten sind repetitiv (dieselben 200 Regisseure in 5000
-- Zeilen). Ohne Cache bedeutet ein authority-Konverter tausende HTTP-Anfragen.
CREATE TABLE IF NOT EXISTS authority_cache (
    id          SERIAL PRIMARY KEY,
    source      TEXT NOT NULL,          -- gnd/wikidata/viaf
    kind        TEXT NOT NULL,          -- subject/person/corporate/place
    query_norm  TEXT NOT NULL,
    result_json JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source, kind, query_norm)
);

-- Stichprobe der Quelldatei (Spalten, ~25 Zeilen, Wertelisten). Damit lässt sich ein
-- Profil auch ohne den zugehörigen Import bearbeiten und die Vorschau bleibt echt.
ALTER TABLE mapping_profiles ADD COLUMN IF NOT EXISTS sample_json JSONB;

-- Anzeigename NEBEN dem Dateinamen, nicht statt seiner: Der Dateiname ist die
-- Verbindung zur Lieferung des Archivs und darf nicht überschrieben werden.
-- Gewünscht von Matti Stöhr, weil mehrere Läufe derselben Datei in der Liste
-- nur am Zeitstempel zu unterscheiden waren.
ALTER TABLE imports ADD COLUMN IF NOT EXISTS label              TEXT;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS sheet_name         TEXT;   -- gewähltes Tabellenblatt
ALTER TABLE imports ADD COLUMN IF NOT EXISTS header_hash        TEXT;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS mapping_profile_id INTEGER REFERENCES mapping_profiles(id) ON DELETE SET NULL;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS mapping_version    INTEGER;

-- Bestandteile des Formathinweises (Format, Blattname, Spalten- bzw. Blattzahl).
-- Der Satz wird erst in der Oberfläche gebildet, damit er übersetzbar ist;
-- detected_format bleibt als fertiger deutscher Text der Rückfall für Altbestand.
ALTER TABLE imports ADD COLUMN IF NOT EXISTS format_detail      JSONB;

-- Reproduzierbarkeit: Womit ist dieses Ergebnis entstanden?
--
-- Das Trennzeichen wurde bisher bei JEDEM Lesen neu geraten und stand nirgends.
-- Damit konnte dieselbe Datei nach einer Aenderung an der Heuristik anders
-- zerfallen, ohne dass sich Datei oder Profil geaendert haetten.
-- run_config haelt daneben fest, mit welcher Profilversion, welcher
-- Schemaversion und welchen Normdateneinstellungen konvertiert wurde. Daraus
-- laesst sich erkennen, ob ein Ergebnis noch zum heutigen Stand passt.
ALTER TABLE imports ADD COLUMN IF NOT EXISTS delimiter          TEXT;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS run_config         JSONB;

CREATE INDEX IF NOT EXISTS idx_mapping_profiles_hash ON mapping_profiles(header_hash);
CREATE INDEX IF NOT EXISTS idx_imports_header_hash   ON imports(header_hash);

DO $$ BEGIN
    CREATE TYPE job_status AS ENUM ('queued','running','done','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Worker-Queue: der worker-Daemon konsumiert per SELECT … FOR UPDATE SKIP LOCKED
-- (kein Redis nötig) und ruft \worker\<classname>::run($payload) auf.
CREATE TABLE IF NOT EXISTS worker_jobs (
    id           SERIAL PRIMARY KEY,
    classname    TEXT NOT NULL,                -- Worker-Klasse: detect / convert / download / register_pid
    import_id    UUID REFERENCES imports(id) ON DELETE CASCADE,   -- optional, für Cascade-Cleanup
    payload      JSONB NOT NULL DEFAULT '{}',
    status       job_status NOT NULL DEFAULT 'queued',
    attempts     INTEGER NOT NULL DEFAULT 0,
    run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),   -- frühester Ausführungszeitpunkt
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at   TIMESTAMPTZ,
    finished_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_imports_institution ON imports(institution_id);
CREATE INDEX IF NOT EXISTS idx_records_import       ON records(import_id);
CREATE INDEX IF NOT EXISTS idx_worker_jobs_status   ON worker_jobs(status, run_at);

-- Start-Institution (Passwort des Admin-Users setzt der Seed-Bot).
INSERT INTO institutions (name, slug) VALUES ('Deutsches Filminstitut', 'dfi')
    ON CONFLICT (slug) DO NOTHING;
