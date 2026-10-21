-- EDUX Phase 2A: Topic Mapping. Review this migration before applying.
-- This file is intentionally NOT executed automatically by the application.
BEGIN;

CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id UUID NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_topics_id_subject UNIQUE (id, subject_id),
  CONSTRAINT chk_topics_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT fk_topics_parent_same_subject
    FOREIGN KEY (parent_id, subject_id) REFERENCES topics(id, subject_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_topics_subject_name_ci ON topics (subject_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_topics_subject_active ON topics (subject_id, is_active);

CREATE TABLE IF NOT EXISTS flashcard_topics (
  flashcard_id UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE RESTRICT,
  mapping_source VARCHAR(20) NOT NULL DEFAULT 'manual'
    CHECK (mapping_source IN ('ai', 'lecturer', 'manual')),
  review_status VARCHAR(20) NOT NULL DEFAULT 'pending_review'
    CHECK (review_status IN ('pending_review', 'approved', 'rejected')),
  ai_confidence NUMERIC(4,3) NULL CHECK (ai_confidence >= 0 AND ai_confidence <= 1),
  ai_explanation TEXT NULL,
  mapped_by UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (flashcard_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_flashcard_topics_analytics ON flashcard_topics (topic_id, review_status, flashcard_id);

CREATE TABLE IF NOT EXISTS flashcard_topic_classifications (
  flashcard_id UUID PRIMARY KEY REFERENCES flashcards(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'classified', 'needs_review', 'failed')),
  model VARCHAR(100) NULL,
  confidence NUMERIC(4,3) NULL CHECK (confidence >= 0 AND confidence <= 1),
  result JSONB NULL,
  failure_code VARCHAR(100) NULL,
  attempted_at TIMESTAMPTZ NULL,
  retry_after TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION edux_assert_flashcard_topic_subject_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE card_subject UUID; topic_subject UUID;
BEGIN
  SELECT fd.subject_id INTO card_subject FROM flashcards fc JOIN flashcard_decks fd ON fd.id = fc.deck_id WHERE fc.id = NEW.flashcard_id;
  SELECT subject_id INTO topic_subject FROM topics WHERE id = NEW.topic_id;
  IF card_subject IS NULL OR topic_subject IS NULL OR card_subject <> topic_subject THEN
    RAISE EXCEPTION 'Topic and Flashcard must belong to the same subject';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION edux_assert_existing_topic_mappings_match()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM flashcard_topics ft
    JOIN flashcards fc ON fc.id = ft.flashcard_id
    JOIN flashcard_decks fd ON fd.id = fc.deck_id
    JOIN topics t ON t.id = ft.topic_id
    WHERE fd.subject_id <> t.subject_id
      AND ((TG_TABLE_NAME = 'flashcards' AND fc.id = NEW.id)
        OR (TG_TABLE_NAME = 'flashcard_decks' AND fd.id = NEW.id)
        OR (TG_TABLE_NAME = 'topics' AND t.id = NEW.id))
  ) THEN
    RAISE EXCEPTION 'Change would violate Flashcard Topic subject invariant';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION edux_mark_flashcard_topic_mapping_stale()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE current_hash TEXT;
BEGIN
  IF OLD.type IS NOT DISTINCT FROM NEW.type
     AND OLD.question IS NOT DISTINCT FROM NEW.question
     AND OLD.answer IS NOT DISTINCT FROM NEW.answer
     AND OLD.explanation IS NOT DISTINCT FROM NEW.explanation
     AND OLD.options IS NOT DISTINCT FROM NEW.options
     AND OLD.difficulty IS NOT DISTINCT FROM NEW.difficulty THEN
    RETURN NEW;
  END IF;
  current_hash := md5(concat_ws('|', NEW.type, NEW.question, NEW.answer, NEW.explanation, NEW.options::text, NEW.difficulty));
  UPDATE flashcard_topics SET review_status = 'pending_review', updated_at = NOW()
    WHERE flashcard_id = NEW.id AND review_status <> 'rejected';
  INSERT INTO flashcard_topic_classifications (flashcard_id, content_hash, status, updated_at)
    VALUES (NEW.id, current_hash, 'pending', NOW())
  ON CONFLICT (flashcard_id) DO UPDATE SET content_hash = EXCLUDED.content_hash, status = 'pending', result = NULL,
    confidence = NULL, failure_code = NULL, retry_after = NULL, updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_flashcard_topics_subject_match ON flashcard_topics;
CREATE TRIGGER trg_flashcard_topics_subject_match BEFORE INSERT OR UPDATE OF flashcard_id, topic_id ON flashcard_topics
  FOR EACH ROW EXECUTE FUNCTION edux_assert_flashcard_topic_subject_match();
DROP TRIGGER IF EXISTS trg_flashcard_mapping_subject_on_card ON flashcards;
CREATE TRIGGER trg_flashcard_mapping_subject_on_card AFTER UPDATE OF deck_id ON flashcards
  FOR EACH ROW EXECUTE FUNCTION edux_assert_existing_topic_mappings_match();
DROP TRIGGER IF EXISTS trg_flashcard_mapping_subject_on_deck ON flashcard_decks;
CREATE TRIGGER trg_flashcard_mapping_subject_on_deck AFTER UPDATE OF subject_id ON flashcard_decks
  FOR EACH ROW EXECUTE FUNCTION edux_assert_existing_topic_mappings_match();
DROP TRIGGER IF EXISTS trg_flashcard_mapping_subject_on_topic ON topics;
CREATE TRIGGER trg_flashcard_mapping_subject_on_topic AFTER UPDATE OF subject_id ON topics
  FOR EACH ROW EXECUTE FUNCTION edux_assert_existing_topic_mappings_match();
DROP TRIGGER IF EXISTS trg_flashcard_mapping_stale ON flashcards;
CREATE TRIGGER trg_flashcard_mapping_stale AFTER UPDATE OF type, question, answer, explanation, options, difficulty ON flashcards
  FOR EACH ROW EXECUTE FUNCTION edux_mark_flashcard_topic_mapping_stale();

COMMIT;
