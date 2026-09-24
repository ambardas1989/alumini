# Development Notes

## Testing channel access

Classroom creator = always admin. To test correctly:
1. Create classroom with account A (becomes admin)
2. Join with account B as student
3. Test Staff Room — account B sees restriction message
4. Test Student Alley — account B has full access

Test accounts:
- textambar@gmail.com — platform admin
- testuser1@yopmail.com — admin of KV Fort William
- testuser2@yopmail.com — create this for student testing

## Browser testing

If API calls show "provisional headers" and get cancelled:
- Browser extension is blocking the request
- Test in Incognito (Ctrl+Shift+N) — disables extensions
- Common culprits: uBlock Origin, Privacy Badger, ad blockers
- Always use Incognito for production testing

## Running Supabase migrations

Migration files in supabase/migrations/ must be run
manually in Supabase SQL Editor.
They are NOT auto-applied.
Check supabase/migrations/README.md for status of each.

## Before deploying a new feature

1. Check if any new migration files were added
2. Run them in Supabase SQL Editor IN ORDER
3. Verify the table exists before testing the feature
4. Update supabase/migrations/README.md status

This prevents PGRST205 "table not found" errors in production.

## Log levels and monitoring

Set LOG_LEVEL in .env or Render environment:
  debug — all logs (use now during development)
  info  — business events only (use at public launch)
  warn  — warnings and errors
  error — errors only

Current Render setting: LOG_LEVEL=debug

To view logs:
  Render → alumini → Logs tab → Application logs

Useful log searches in Render:
  [ERROR]     — all errors
  [AUTH]      — authentication events
  [CORRIDOR]  — messaging events
  [CLASSROOM] — classroom events
  [DM]        — direct messages
  [VERIFY]    — verification events

To change log level without redeploying:
  Render → alumini → Environment → LOG_LEVEL → Save
  Service restarts automatically with new level.
