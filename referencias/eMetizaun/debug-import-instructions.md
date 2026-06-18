# Debug Steps for CSV Import Issue

## Please follow these steps to help debug the import issue:

1. **Open the browser developer console** (F12 or Cmd+Option+I on Mac)

2. **Navigate to** http://localhost:8081/companies

3. **Clear the console** and keep it open

4. **Try importing the test CSV file**: `test-company.csv` (I created a simple one with just one company)

5. **Check the console logs** for these messages:
   - "CSV Headers found:" - Shows what headers were detected
   - "Parsed companies:" - Shows the parsed company data
   - "ImportCompaniesDialog: Starting import with companies:" - Shows what's being sent to import
   - "Starting import of companies:" - Shows the import process starting
   - "createCompany: Creating company with data:" - Shows each company being created
   - "fetchCompanies: Fetching for organization:" - Shows when fetching companies
   - "fetchCompanies: User role in organization:" - Shows if user has proper role
   - "fetchCompanies: Retrieved companies:" - Shows how many companies were retrieved

## Key things to look for:

1. **Organization ID**: Make sure `organization_id` is not null when creating companies
2. **User Role**: Check if "User role in organization" shows a valid role
3. **Any error messages** in red in the console
4. **The number of companies retrieved** after import

## If you see an error about "No organization selected":

This means the organization context is not properly set. Try:
1. Refresh the page
2. Log out and log back in
3. Check if you're part of an organization

## Alternative Test:

You can also try creating a company manually using the "Add Company" button to see if that works. If manual creation works but import doesn't, the issue is specific to the import process.

## Please share:
- Any error messages from the console
- The log messages you see during import
- Whether manual company creation works

This will help identify if the issue is with:
- CSV parsing
- Organization/authentication context
- Database permissions (RLS)
- The import process itself
