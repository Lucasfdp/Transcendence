# srcs/secrets/

This directory holds Docker Secret files for production use.

## IMPORTANT

- This directory is listed in `.gitignore` — its contents are NEVER committed to version control.
- Files placed here are mounted as Docker Secrets (available at `/run/secrets/<name>` inside containers).
- In development, credentials can be passed via `.env`. For production, use Docker Secrets.

## Expected files (create locally, never commit)

| File | Used by | Purpose |
|------|---------|---------|
| `db_password.txt` | database, backend | PostgreSQL password |
| `redis_password.txt` | redis, backend | Redis authentication password |
| `secret_key.txt` | backend | Django / FastAPI secret key |
| `jwt_secret.txt` | backend | JWT signing secret |
| `blockchain_key.txt` | blockchain_service | Wallet private key (bonus) |

## Generating secret files

```bash
# Generate a strong random secret
openssl rand -hex 32 > srcs/secrets/secret_key.txt
openssl rand -hex 32 > srcs/secrets/jwt_secret.txt

# Set a database password
echo "my_strong_db_password" > srcs/secrets/db_password.txt

# Secure the files
chmod 600 srcs/secrets/*.txt
```
