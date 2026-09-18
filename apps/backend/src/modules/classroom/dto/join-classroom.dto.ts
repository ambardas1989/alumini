/**
 * Empty on purpose. Joining a classroom takes no client-supplied fields —
 * role is always decided server-side (see ClassroomService.joinClassroom()):
 * 'student' by default, 'teacher' only if the caller already holds an
 * active teacher persona at this classroom's institution. A client-supplied
 * role would be a privilege-escalation vector (e.g. claiming 'admin'), so
 * it's never accepted as input.
 *
 * This DTO exists so the controller still has a typed request body for
 * Swagger docs and so the global ValidationPipe's forbidNonWhitelisted
 * rule actively strips/rejects any unexpected fields (like a spoofed role)
 * a client might send, rather than silently accepting a bare `{}`.
 */
export class JoinClassroomDto {}
