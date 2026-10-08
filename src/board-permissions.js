import { currentSession, settings } from './member-auth.js';
import { memberProfile } from './social-auth.js';
export const isOperator = profile => profile?.username?.toLowerCase() === 'lsh451600';
export async function boardIdentity(request, env) {
  if (!settings(env).ready) return null;
  const session = await currentSession(request, env);
  if (!session.user) return null;
  const profile = await memberProfile(env, session);
  return { id: session.user.id, isAdmin: isOperator(profile) };
}
export function canManagePost(identity, authorId) {
  return Boolean(identity && (identity.isAdmin || (authorId && identity.id === authorId)));
}
