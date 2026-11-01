/** Whether a path belongs to the client-rendered session application. */
export function isSessionPagePath(path: string): boolean {
  return path.startsWith('/s/');
}
