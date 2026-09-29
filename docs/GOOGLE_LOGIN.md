# Google login

EDUX supports Google sign-in for existing accounts only.

Public self-registration is not exposed by the auth router. User accounts continue to be created through the existing Admin account-management flow.

## Endpoint

`POST /api/auth/google`

```json
{
  "credential": "google-id-token"
}
```

The backend verifies the Google ID token with `GOOGLE_CLIENT_ID`, requires a verified email, and looks up that email in `users`. It never creates or updates a user from Google profile data.

- Missing EDUX account: `403`
- Inactive EDUX account: `403`
- Invalid or expired Google token: `401`
- Valid existing account: returns the same EDUX access token, refresh token, and user payload as password login

Configure the same OAuth 2.0 Web client ID in backend `GOOGLE_CLIENT_ID` and frontend `VITE_GOOGLE_CLIENT_ID`. Add the frontend origin, such as `http://localhost:5173`, to the Google OAuth client's Authorized JavaScript origins.
