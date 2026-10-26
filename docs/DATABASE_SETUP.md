# MongoDB Atlas setup

No live Atlas credentials are included in this repository, and Atlas
connectivity is not assumed. Never put a MongoDB URI in the Android app.

## Set up an application database user

1. Treat any MongoDB password previously pasted into chat, source code, or logs
   as compromised. Rotate it before connecting this project; do not reuse or
   copy the old value.
2. Create a dedicated database user for CliQHeart with only the database
   privileges the application needs. Do not use an Atlas project owner or
   administrator identity as the application user.
3. Confirm the intended Atlas cluster and database name (`cliqheart` by
   default).
4. Allowlist only the development computer's current public IP for local
   development. Prefer a private network/VPN or tightly scoped deployment
   network for production. Do not use unrestricted public access to bypass a
   connection problem.
5. In Atlas, select **Connect** -> **Drivers** and copy the MongoDB driver URI.
   Keep the URI in the backend only.
6. Copy `backend/.env.example` to `backend/.env`, set `MONGODB_URI` and
   `MONGODB_DB_NAME`, and keep `.env` out of Git. Set `CORS_ORIGINS` to an
   explicit comma-separated browser-origin allowlist if browser clients are
   used; native Android requests do not require CORS. JWT secrets are not
   needed before the authentication phase.
7. Start the backend and check `GET /api/v1/health`. A ready response is the
   evidence that the backend connected with the current settings.
8. Confirm Android calls only the API; it must never contain the Atlas URI.

## Connection URI and troubleshooting

Use the Atlas driver URI format and the newly rotated database-user password.
When credentials contain URI-reserved characters, percent-encode them according
to MongoDB's URI rules. Do not construct a URI in source code or paste one into
logs, tickets, or documentation.

If startup cannot connect, check that the database username/password are
correct, the database name is intended, the cluster is running, and the
development IP is allowlisted. Keep Atlas network restrictions in place.

The app uses the Mongoose connection lifecycle and a finite server-selection
timeout. A failed required startup dependency is a startup failure; the
application does not report a ready health status while MongoDB is
disconnected. Automated tests do not require Atlas credentials.
