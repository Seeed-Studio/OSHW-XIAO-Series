CREATE TABLE project_likes (
    project_url TEXT NOT NULL,
    voter_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_url, voter_hash)
);

CREATE INDEX project_likes_voter_hash ON project_likes (voter_hash);
