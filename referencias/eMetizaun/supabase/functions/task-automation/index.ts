import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { trigger_type, data, organization_id } = await req.json();

    console.log('Processing automation trigger:', { trigger_type, organization_id, data });

    // Get all enabled rules for this trigger type and organization
    const { data: rules, error: rulesError } = await supabase
      .from('task_automation_rules')
      .select('*')
      .eq('trigger_type', trigger_type)
      .eq('organization_id', organization_id)
      .eq('enabled', true);

    if (rulesError) {
      console.error('Error fetching rules:', rulesError);
      throw rulesError;
    }

    console.log(`Found ${rules?.length || 0} matching rules`);

    if (!rules || rules.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No matching rules found' }), 
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const tasksCreated = [];

    // Process each rule
    for (const rule of rules) {
      console.log('Processing rule:', rule.name);

      // Check if the rule conditions are met
      if (await checkRuleConditions(rule, data, trigger_type)) {
        // Create task from template
        const task = await createTaskFromTemplate(supabase, rule, data, organization_id);
        if (task) {
          tasksCreated.push(task);
        }
      }
    }

    console.log(`Created ${tasksCreated.length} tasks`);

    return new Response(
      JSON.stringify({ 
        message: `Processed ${rules.length} rules, created ${tasksCreated.length} tasks`,
        tasks_created: tasksCreated 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in task automation:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

async function checkRuleConditions(rule: any, data: any, triggerType: string): Promise<boolean> {
  console.log('Checking conditions for rule:', rule.name, 'Trigger:', triggerType);

  // If no conditions specified, rule matches
  if (!rule.trigger_conditions || Object.keys(rule.trigger_conditions).length === 0) {
    console.log('No conditions specified, rule matches');
    return true;
  }

  const conditions = rule.trigger_conditions;

  switch (triggerType) {
    case 'deal_stage_changed':
      if (conditions.from_stage && data.old_stage !== conditions.from_stage) {
        console.log('From stage condition not met');
        return false;
      }
      if (conditions.to_stage && data.new_stage !== conditions.to_stage) {
        console.log('To stage condition not met');
        return false;
      }
      break;
    
    case 'birthday_approaching':
    case 'anniversary_approaching':
    case 'important_date_approaching':
      // These would typically be triggered by a scheduled function
      // that checks dates and creates the automation events
      break;
  }

  console.log('All conditions met for rule:', rule.name);
  return true;
}

async function createTaskFromTemplate(
  supabase: any, 
  rule: any, 
  data: any, 
  organizationId: string
): Promise<any> {
  try {
    console.log('Creating task from template for rule:', rule.name);

    const template = rule.task_template;
    
    // Process template with dynamic values
    const processedTitle = replacePlaceholders(template.title, data);
    const processedDescription = template.description ? replacePlaceholders(template.description, data) : null;

    // Calculate due date
    let dueDate = null;
    if (template.due_date_offset && template.due_date_offset > 0) {
      const now = new Date();
      now.setDate(now.getDate() + template.due_date_offset);
      dueDate = now.toISOString().split('T')[0]; // YYYY-MM-DD format
    }

    // Determine assignee based on template settings
    let assignedTo = null;
    let taskCreatorId = rule.user_id; // Default to rule creator
    
    if (template.assign_to === 'creator') {
      // Assign to the person who created the triggering entity
      assignedTo = data.user_id || null;
    } else if (template.assign_to === 'specific_user' && template.assigned_user_id) {
      assignedTo = template.assigned_user_id;
    }
    
    console.log('Assigning task to:', assignedTo, 'based on template assign_to:', template.assign_to);

    const taskData = {
      title: processedTitle,
      description: processedDescription,
      status: template.status || 'Pending',
      priority: template.priority || 'Medium',
      due_date: dueDate,
      user_id: taskCreatorId,
      assigned_to: assignedTo,
      organization_id: organizationId,
      // Link to related entities if available
      ...(data.deal_id && { deal_id: data.deal_id }),
      ...(data.contact_id && { contact_id: data.contact_id }),
      ...(data.company_id && { company_id: data.company_id }),
    };

    console.log('Creating task with data:', taskData);

    const { data: task, error } = await supabase
      .from('tasks')
      .insert([taskData])
      .select()
      .single();

    if (error) {
      console.error('Error creating task:', error);
      throw error;
    }

    console.log('Task created successfully:', task.id);
    return task;

  } catch (error) {
    console.error('Error creating task from template:', error);
    return null;
  }
}

function replacePlaceholders(text: string, data: any): string {
  let result = text;
  
  // Replace common placeholders
  const placeholders = {
    '{{contact_name}}': data.contact_name || data.first_name && data.last_name ? `${data.first_name} ${data.last_name}` : 'Contact',
    '{{contact_first_name}}': data.first_name || 'Contact',
    '{{contact_last_name}}': data.last_name || '',
    '{{contact_email}}': data.email || '',
    '{{company_name}}': data.company_name || data.company || 'Company',
    '{{deal_title}}': data.title || data.deal_title || 'Deal',
    '{{deal_value}}': data.value || data.deal_value || '',
    '{{contact_birthday}}': data.birthday || '',
    '{{contact_anniversary}}': data.anniversary || '',
    '{{lead_name}}': data.lead_name || `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Lead',
  };

  for (const [placeholder, value] of Object.entries(placeholders)) {
    result = result.replace(new RegExp(placeholder, 'g'), String(value));
  }

  return result;
}