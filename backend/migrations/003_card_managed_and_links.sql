ALTER TABLE cards ADD COLUMN managed INTEGER NOT NULL DEFAULT 1;

CREATE TABLE card_links (
    card_id TEXT NOT NULL,
    linked_card_id TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (card_id, linked_card_id),
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (linked_card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE INDEX idx_card_links_linked ON card_links(linked_card_id);
