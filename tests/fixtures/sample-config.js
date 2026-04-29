export default {
  app: 'magpipe',
  envs: {
    staging: 'https://magpipe-staging-snapsonic.vercel.app',
    prod: 'https://magpipe.ai',
  },
  auth: {
    type: 'form',
    loginUrl: 'https://magpipe-staging-snapsonic.vercel.app/login',
    loginRequestBody: 'email={%username%}&password={%password%}',
    usernameField: 'email',
    passwordField: 'password',
    loggedInIndicator: 'Sign out|/dashboard',
  },
};
