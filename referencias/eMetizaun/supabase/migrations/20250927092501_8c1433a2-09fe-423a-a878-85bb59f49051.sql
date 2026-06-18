-- Clean up duplicate organization memberships for Test user (test7)
-- Keep only the intended organization membership (85a69a20-c896-4042-bdc4-89e61066325c)
DELETE FROM user_roles 
WHERE user_id = (SELECT user_id FROM profiles WHERE display_name = 'Test' LIMIT 1)
  AND role = 'owner'
  AND organization_id != '85a69a20-c896-4042-bdc4-89e61066325c';

-- Also remove the orphaned organizations that were auto-created for this user
DELETE FROM organizations 
WHERE name LIKE 'Test''s CRM'
  AND id != '85a69a20-c896-4042-bdc4-89e61066325c'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE organization_id = organizations.id
  );