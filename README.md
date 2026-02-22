# CodePush Server

The CodePush Server is a Node.js application that powers the CodePush Service. It allows users to deploy and manage over-the-air updates for their react-native applications in a self-hosted environment.

Please refer to [react-native-code-push](https://github.com/microsoft/react-native-code-push) for instructions on how to onboard your application to CodePush.

## Deployment

### Docker & Self-Hosting (Dokploy / Coolify etc)

CodePush Server has been updated with a built-in LocalStorage driver, meaning you no longer need an external cloud provider (like Azure or AWS) or Azurite to host your payloads. Deployments and your application database are all stored locally on the file system in a directory of your choice.

This makes deploying via Docker incredibly easy!

#### Deployment Steps using `docker-compose`

1. Clone the CodePush Service repository to your server.
2. Ensure you have Docker and Docker Compose installed.
3. Review the included `docker-compose.yml` file. By default, it includes:
   - A Redis cache container
   - The CodePush Server running your local storage strategy
4. Create an `.env` file (you can copy `.env.example`).
   Ensure you fill out the following crucial environment variables:
   ```bash
   SERVER_URL=https://codepush.yourdomain.com
   STORAGE_DIR=/storage
   GITHUB_CLIENT_ID=your_id
   GITHUB_CLIENT_SECRET=your_secret
   ```
5. Spin up the cluster:
   ```bash
   docker-compose up -d
   ```

#### Dokploy / Coolify Deployment

If you are using a modern deployment platform like Dokploy:

1. **Create a new Compose Application** in Dokploy.
2. Connect it to your Git repository holding this codebase.
3. Your **Compose Path** should point to `./docker-compose.yml`.
4. In your Environment Variables tab inside Dokploy, configure standard OAuth credentials and set `SERVER_URL`.
5. Map a **Persistent Volume** in Dokploy to `/storage` in the container. This ensures your CodePush apps, database, and payload blobs persist between container restarts!
6. Click **Deploy**.

## Configure react-native-code-push

In order for [react-native-code-push](https://github.com/microsoft/react-native-code-push) to use your server, additional configuration value is needed.

### Android

in `strings.xml`, add following line, replacing `server-url` with your server.

```
<string moduleConfig="true" name="CodePushServerUrl">server-url</string>
```

### iOS

in `Info.plist` file, add following lines, replacing `server-url` with your server.

```
<key>CodePushServerURL</key>
<string>server-url</string>
```

## OAuth apps

CodePush uses GitHub and Microsoft as identity providers, so for authentication purposes, you need to have an OAuth App registration for CodePush.
Client id and client secret created during registration should be provided to the CodePush server in environment variables.
Below are instructions on how to create OAuth App registrations.

### GitHub

1. Go to https://github.com/settings/developers
1. Click on `New OAuth App`
1. `Homepage URL` parameter will be the same as URL of your CodePush application on Azure - `https://codepush-<project-suffix>.azurewebsites.net` (for local development it will be either http://localhost:3000 or https://localhost:8443)
1. `Authorization callback URL` will be `https://codepush-<project-suffix>.azurewebsites.net/auth/callback/github` (for local development it will be either http://localhost:3000/auth/callback/github or https://localhost:8443/auth/callback/github)

### Microsoft

Both work and personal accounts use the same application for authentication. The only difference is property `Supported account types` that is set when creating the app.

1. Register an Azure Registered Application following [official guideline](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app#register-an-application)
1. For option `Supported account types`:
   1. If you want to support both Personal and Work accounts, select `Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)`
   1. If you want to only support Work accounts, choose either `Accounts in this organizational directory only (<your directory> - Single tenant)` or `Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)` depending if you want to support Single or Multitenant authorization. Make sure to set `MICROSOFT_TENANT_ID` envrionment variable in case of using single tenant application.
   1. If you want to only support Personal accounts, select `Personal Microsoft accounts only`
1. Set up Redirect URI(s) depending on the choice you made for `Supported account types`. If you choose both Personal and Work accounts, you need to add both redirect URIs, otherwise just one of the ones:
   1. Personal account: `https://codepush-<project-suffix>.azurewebsites.net/auth/callback/microsoft` (for local development it will be either http://localhost:3000/auth/callback/microsoft or https://localhost:8443/auth/callback/microsoft)
   1. Work account: `https://codepush-<project-suffix>.azurewebsites.net/auth/callback/azure-ad` (for local development it will be http://localhost:3000/auth/callback/azure-ad or https://localhost:8443/auth/callback/azure-ad)
1. Generate secret following this [official guideline](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app#add-credentials)

## Naming limitations

### project-suffix

1. Only letters are allowed.
1. Maximum 15 characters.

## Metrics

Installation metrics allow monitoring release activity via the CLI. For detailed usage instructions, please refer to the [CLI documentation](../cli/README.md#development-parameter).

Redis is required for Metrics to work.

### Steps

1. Install Redis by following [official installation guide](https://redis.io/docs/latest/operate/oss_and_stack/install/install-redis/).
1. TLS is required. Follow [official Redis TLS run guide](https://redis.io/docs/latest/operate/oss_and_stack/management/security/encryption/#running-manually).
1. Set the necessary environment variables for [Redis](./ENVIRONMENT.md#redis).
