/** Additive, idempotent storage for new class-group learning tools. */
export const CLASS_GROUP_DDL = [
  `CREATE TABLE IF NOT EXISTS class_group_messages (
    id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES learning_program_batches(id) ON DELETE CASCADE,
    sender_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, sender_name text NOT NULL,
    sender_role text NOT NULL, body text NOT NULL, pinned_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS class_group_messages_batch_idx ON class_group_messages(batch_id, id)`,
  `CREATE TABLE IF NOT EXISTS class_group_homework (
    id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES learning_program_batches(id) ON DELETE CASCADE,
    teacher_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, title text NOT NULL,
    instructions text, due_at timestamptz, status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS class_group_homework_batch_idx ON class_group_homework(batch_id, id)`,
  `CREATE TABLE IF NOT EXISTS class_group_homework_submissions (
    id serial PRIMARY KEY, homework_id integer NOT NULL REFERENCES class_group_homework(id) ON DELETE CASCADE,
    student_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, note text NOT NULL,
    status text NOT NULL DEFAULT 'submitted', feedback text,
    submitted_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS class_group_homework_submission_once_idx ON class_group_homework_submissions(homework_id, student_id)`,
  `CREATE INDEX IF NOT EXISTS class_group_homework_submissions_task_idx ON class_group_homework_submissions(homework_id, id)`,
  `CREATE TABLE IF NOT EXISTS class_group_materials (
    id serial PRIMARY KEY, batch_id integer NOT NULL REFERENCES learning_program_batches(id) ON DELETE CASCADE,
    teacher_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT, title text NOT NULL,
    note text, url text, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS class_group_materials_batch_idx ON class_group_materials(batch_id, id)`,
] as const;
