# Environment

The CodePush Server is configured using environment variables.

For convenience, we will also load the server environment from any '.env' file in the root directory. Use the `.env.example` file as a template for setting up your environment variables.

## Mandatory parameters

### Storage

CodePush uses a high-performance local storage system for zero-dependency deployments.

- `STORAGE_DIR`: The path to the directory where your payload blobs and internal databases will be stored. When running in Docker, this should point to a persistent volume (e.g., `/storage`).

#### Alternative Cloud Storage

If you do not want to use local storage, you can omit `STORAGE_DIR` entirely from your environment file and pass your cloud variables instead. CodePush will fallback to its native Azure Storage driver.

- `AZURE_STORAGE_ACCOUNT`: The name of your hosted Azure storage instance.
- `AZURE_STORAGE_ACCESS_KEY`: The key to your Azure storage instance.

### Authentication

- `SERVER_URL`: The URL of your server. E.g., `http://localhost:3000` or `https://codepush.yourdomain.com`. This is required for OAuth redirects.

#### GitHub OAuth

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

#### Microsoft OAuth

- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `MICROSOFT_TENANT_ID`: Required if application registration is single tenant.

## Optional parameters

### Redis

To enable the Redis caching layer (required for metrics), set:

- `REDIS_HOST`: The IP address or container hostname where the Redis server is hosted (e.g.: `redis` in Docker).
- `REDIS_PORT`: The port which Redis is listening on (usually 6379).
- `REDIS_KEY` (If authentication is enabled for Redis): The password used to authenticate requests to the Redis cache.

### Other

- `DISABLE_ACQUISITION`: Set to 'true' to disable acquisition (update downloading) routes
- `DISABLE_MANAGEMENT`: Set to 'true' to disable management (dashboard/cli) routes
- `ENABLE_ACCOUNT_REGISTRATION`: Set to 'false' in order to disable new account registrations
- `UPLOAD_SIZE_LIMIT_MB`: Set to the max number of megabytes allowed for file uploads. Defaults to 200 if unspecified.
- `ENABLE_PACKAGE_DIFFING`: Set to 'true' to enable generating binary diffs for smaller patch releases.

### Debugging

- `LOGGING`: Turn on CodePush-specific logging of API requests.
- `DEBUG_DISABLE_AUTH`: Set to 'true' to skip authentication and impersonate existing user. When set, server uses `DEBUG_USER_ID` as logged in user for all requests requiring authentication.
- `DEBUG_USER_ID`: Backend id of existing user to impersonate when `DEBUG_DISABLE_AUTH` is set to 'true'. Default value: 'default'.
