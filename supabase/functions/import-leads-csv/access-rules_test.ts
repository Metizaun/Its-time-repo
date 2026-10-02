import {
  canImportLeadsToInstance,
  resolveImportedLeadOwner,
} from "./access-rules.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${
        JSON.stringify(actual)
      }`,
    );
  }
}

Deno.test("account admin can import into an instance created by another user", () => {
  assertEquals(
    canImportLeadsToInstance({
      userId: "admin-user",
      userRole: "ADMIN",
      instanceCreatedBy: "another-user",
      membershipAccessLevel: null,
    }),
    true,
  );
});

Deno.test("account admin can import into a legacy instance without created_by", () => {
  assertEquals(
    canImportLeadsToInstance({
      userId: "admin-user",
      userRole: "ADMIN",
      instanceCreatedBy: null,
      membershipAccessLevel: null,
    }),
    true,
  );
  assertEquals(resolveImportedLeadOwner(null, "admin-user"), "admin-user");
});

Deno.test("non-admin needs ownership or editor membership", () => {
  assertEquals(
    canImportLeadsToInstance({
      userId: "seller-user",
      userRole: "VENDEDOR",
      instanceCreatedBy: "another-user",
      membershipAccessLevel: "viewer",
    }),
    false,
  );
  assertEquals(
    canImportLeadsToInstance({
      userId: "seller-user",
      userRole: "VENDEDOR",
      instanceCreatedBy: "another-user",
      membershipAccessLevel: "editor",
    }),
    true,
  );
  assertEquals(
    canImportLeadsToInstance({
      userId: "seller-user",
      userRole: "VENDEDOR",
      instanceCreatedBy: "seller-user",
      membershipAccessLevel: null,
    }),
    true,
  );
});

Deno.test("instance creator remains the imported lead owner", () => {
  assertEquals(
    resolveImportedLeadOwner("instance-owner", "admin-user"),
    "instance-owner",
  );
});
