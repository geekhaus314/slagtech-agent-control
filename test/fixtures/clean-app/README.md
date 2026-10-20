# Field Notes

Field Notes is a small Next.js app for reading short reports. Posts are listed from a SQLite table through a route handler.

## Run

```bash
npm test
```

Set `DATABASE_PATH` if the database should live somewhere other than `./data/app.db`. The schema is in `lib/server/schema.sql`.
