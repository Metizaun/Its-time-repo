export type InstanceAccessLevel = "viewer" | "editor" | "admin" | null;

export function canImportLeadsToInstance(input: {
  userId: string;
  userRole: string;
  instanceCreatedBy: string | null;
  membershipAccessLevel: InstanceAccessLevel;
}) {
  if (input.userRole === "ADMIN") return true;
  if (input.instanceCreatedBy === input.userId) return true;

  return input.membershipAccessLevel === "editor" ||
    input.membershipAccessLevel === "admin";
}

export function resolveImportedLeadOwner(
  instanceCreatedBy: string | null,
  requestingUserId: string,
) {
  return instanceCreatedBy ?? requestingUserId;
}
