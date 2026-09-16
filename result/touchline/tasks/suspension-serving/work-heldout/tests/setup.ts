/** Keeps a test run quiet unless a test asks otherwise. */
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.DATABASE_FILE = ':memory:';
