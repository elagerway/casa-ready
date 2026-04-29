export default {
  app: 'juice-shop',
  envs: {
    staging: 'http://localhost:3000',
  },
  auth: {
    type: 'form',
    loginUrl: 'http://localhost:3000/rest/user/login',
    loginRequestBody: 'email={%username%}&password={%password%}',
    usernameField: 'email',
    passwordField: 'password',
    loggedInIndicator: 'authentication',
  },
};
