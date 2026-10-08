// Call only with a token already validated by Supabase /auth/v1/user.
// Authentication-method timestamps survive refreshes; token issuance time does not.
export function hasRecentAuthentication(access, userId, method, maximumAge, now = Date.now()) {
  try {
    const encoded = access.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return claims.sub === userId && Array.isArray(claims.amr) && claims.amr.some(entry => {
      const timestamp = Number(entry?.timestamp) * 1000;
      return entry?.method === method && Number.isFinite(timestamp) && timestamp <= now + 30000 && now - timestamp <= maximumAge;
    });
  } catch { return false; }
}
