// Zugriffsprüfungen für die API.

import type { FastifyRequest } from 'fastify';
import type { UserRow } from './db.js';
import { UserError } from './legion.js';
import { accessOf, isOfficer } from './users.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
  }
}

/** Angemeldet und nicht gesperrt */
export function requireUser(req: FastifyRequest): UserRow {
  if (!req.user) throw new UserError('Bitte melde dich an.', 401);
  if (req.user.blocked && accessOf(req.user) === 'blocked') throw new UserError('Dein Account ist gesperrt.', 403, 'blocked');
  return req.user;
}

/** Angemeldet und Zugang (Main in der Legion) */
export function requireAccess(req: FastifyRequest): UserRow {
  const u = requireUser(req);
  const a = accessOf(u);
  if (a !== 'ok') throw new UserError('Kein Zugang – dein Main ist nicht als Mitglied bestätigt.', 403, a);
  return u;
}

export function requireOfficer(req: FastifyRequest): UserRow {
  const u = requireAccess(req);
  if (!isOfficer(u)) throw new UserError('Nur für Offiziere.', 403);
  return u;
}
