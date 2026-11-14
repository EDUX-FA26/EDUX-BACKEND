CREATE TABLE IF NOT EXISTS forum_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  flashcard_deck_id UUID REFERENCES flashcard_decks(id) ON DELETE SET NULL,
  visibility VARCHAR(20) NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'CLASS_ONLY', 'PRIVATE')),
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  comments_locked BOOLEAN NOT NULL DEFAULT FALSE,
  post_type VARCHAR(20) NOT NULL DEFAULT 'DISCUSSION' CHECK (post_type IN ('DISCUSSION', 'CONFESSION')),
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS forum_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES forum_comments(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE forum_comments ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS post_type VARCHAR(20) NOT NULL DEFAULT 'DISCUSSION';
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS is_anonymous BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE forum_posts ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE SET NULL;

UPDATE forum_posts fp
SET school_id = sm.school_id
FROM school_memberships sm
WHERE fp.school_id IS NULL
  AND sm.user_id = fp.author_id
  AND sm.status = 'active';

CREATE INDEX IF NOT EXISTS forum_posts_school_idx ON forum_posts (school_id, created_at DESC);

CREATE TABLE IF NOT EXISTS forum_post_likes (
  post_id UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS forum_post_classes (
  post_id UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, class_id)
);

CREATE INDEX IF NOT EXISTS forum_posts_created_at_idx ON forum_posts (created_at DESC);
CREATE INDEX IF NOT EXISTS forum_posts_subject_idx ON forum_posts (subject_id);
CREATE INDEX IF NOT EXISTS forum_comments_post_idx ON forum_comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS forum_post_classes_class_idx ON forum_post_classes (class_id, post_id);
