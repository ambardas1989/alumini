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
