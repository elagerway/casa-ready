// macOS / Windows Docker Desktop note: ZAP runs inside a container and reaches
// the host via `host.docker.internal`. On Linux (including GHA ubuntu-latest
// runners), use `localhost` after passing `--network=host` to docker, OR
// switch this URL to `http://172.17.0.1:3000` (the default docker0 bridge).
// V1 default targets macOS dev (Erik's platform); CI runners need to override.
export default {
  app: 'juice-shop',
  envs: {
    staging: 'http://host.docker.internal:3000',
  },
  auth: {
    type: 'form',
    loginUrl: 'http://host.docker.internal:3000/rest/user/login',
    loginRequestBody: 'email={%username%}&password={%password%}',
    usernameField: 'email',
    passwordField: 'password',
    loggedInIndicator: 'authentication',
  },
};
