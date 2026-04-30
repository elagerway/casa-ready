export default {
  app: 'magpipe',
  envs: {
    staging: {
      targets: [
        {
          name: 'spa',
          url: 'https://staging.magpipe.ai',
          auth: {
            type: 'form',
            loginUrl: 'https://staging.magpipe.ai/login',
            loginRequestBody: 'email={%username%}&password={%password%}',
            usernameField: 'email',
            passwordField: 'password',
            loggedInIndicator: 'Sign out|/dashboard',
          },
        },
        {
          name: 'api',
          url: 'https://x.supabase.co/functions/v1',
          auth: {
            type: 'supabase-jwt',
            loginUrl: 'https://x.supabase.co/auth/v1/token?grant_type=password',
            apiKey: 'public-anon-key-here',
            refreshSeconds: 3300,
          },
        },
      ],
    },
    prod: {
      targets: [
        {
          name: 'spa',
          url: 'https://magpipe.ai',
          auth: {
            type: 'form',
            loginUrl: 'https://magpipe.ai/login',
            loginRequestBody: 'email={%username%}&password={%password%}',
            usernameField: 'email',
            passwordField: 'password',
            loggedInIndicator: 'Sign out|/dashboard',
          },
        },
      ],
    },
  },
};
