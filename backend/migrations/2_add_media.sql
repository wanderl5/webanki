-- Add media column to cards for image/audio attachments
ALTER TABLE cards ADD COLUMN media TEXT NOT NULL DEFAULT '[]';
