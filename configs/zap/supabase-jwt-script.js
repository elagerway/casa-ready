// CASA Ready — Supabase JWT auth script for ZAP type=4 (script-based auth).
//
// Runs inside ZAP's Nashorn / Graal JavaScript interpreter at scan time.
// ZAP calls authenticate() with the user's credentials and the script's
// configured params (loginUrl + apiKey). The script does the Supabase login,
// extracts access_token from the JSON response, and stores it in a ZAP
// session variable called `token` that the context's session config injects
// into subsequent requests as `Authorization: Bearer <token>`.
//
// Required ZAP imports (Nashorn ESM-style):
var HttpRequestHeader = Java.type('org.parosproxy.paros.network.HttpRequestHeader');
var HttpHeader = Java.type('org.parosproxy.paros.network.HttpHeader');
var URI = Java.type('org.apache.commons.httpclient.URI');

function authenticate(helper, paramsValues, credentials) {
  var loginUrl = paramsValues.get('loginUrl');
  var apiKey = paramsValues.get('apiKey');
  var username = credentials.getParam('Username');
  var password = credentials.getParam('Password');

  // Build the JSON body. Supabase expects {"email": "...", "password": "..."}.
  var body = JSON.stringify({ email: username, password: password });

  var requestUri = new URI(loginUrl, false);
  var msg = helper.prepareMessage();
  var requestHeader = new HttpRequestHeader(
    HttpRequestHeader.POST,
    requestUri,
    HttpHeader.HTTP11
  );
  msg.setRequestHeader(requestHeader);
  msg.getRequestHeader().setHeader('apikey', apiKey);
  msg.getRequestHeader().setHeader('Content-Type', 'application/json');
  msg.setRequestBody(body);
  msg.getRequestHeader().setContentLength(msg.getRequestBody().length());

  helper.sendAndReceive(msg);

  var responseBody = msg.getResponseBody().toString();
  var parsed;
  try {
    parsed = JSON.parse(responseBody);
  } catch (e) {
    throw 'CASA Ready: Supabase auth response was not JSON: ' + responseBody.substring(0, 200);
  }

  if (!parsed.access_token) {
    throw 'CASA Ready: Supabase auth response missing access_token. Got: ' + responseBody.substring(0, 200);
  }

  // Store the token in ZAP's session for subsequent requests.
  // The context's <session><httpauthsessionwrapper> picks this up via the
  // {%token%} template in the Authorization header.
  msg.getRequestingUser().getAuthenticationCredentials();
  helper.getCorrespondingHttpState().setAttribute('token', parsed.access_token);

  return msg;
}

function getRequiredParamsNames() {
  return ['loginUrl', 'apiKey'];
}

function getOptionalParamsNames() {
  return [];
}

function getCredentialsParamsNames() {
  return ['Username', 'Password'];
}
