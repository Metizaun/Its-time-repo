import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, X } from 'lucide-react';

export interface CriteriaRule {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface SmartListCriteriaBuilderProps {
  criteria: CriteriaRule[];
  onChange: (criteria: CriteriaRule[]) => void;
}

const FIELDS = [
  { value: 'status', label: 'Status' },
  { value: 'source', label: 'Source' },
  { value: 'score', label: 'Score' },
  { value: 'company', label: 'Company' },
  { value: 'industry', label: 'Industry' },
  { value: 'location', label: 'Location' },
  { value: 'title', label: 'Title' },
  { value: 'created_at', label: 'Created Date' },
];

const OPERATORS = {
  text: [
    { value: 'equals', label: 'Equals' },
    { value: 'contains', label: 'Contains' },
    { value: 'starts_with', label: 'Starts with' },
    { value: 'ends_with', label: 'Ends with' },
    { value: 'not_equals', label: 'Does not equal' },
  ],
  number: [
    { value: 'equals', label: 'Equals' },
    { value: 'greater_than', label: 'Greater than' },
    { value: 'less_than', label: 'Less than' },
    { value: 'greater_equal', label: 'Greater than or equal' },
    { value: 'less_equal', label: 'Less than or equal' },
  ],
  date: [
    { value: 'equals', label: 'On date' },
    { value: 'after', label: 'After' },
    { value: 'before', label: 'Before' },
    { value: 'in_last_days', label: 'In last X days' },
  ],
};

const STATUS_OPTIONS = ['New', 'Contacted', 'Qualified', 'Unqualified', 'Lost'];
const SOURCE_OPTIONS = ['Website', 'Referral', 'Social Media', 'Advertisement', 'Trade Show', 'Cold Call', 'Email Campaign', 'Other'];

export function SmartListCriteriaBuilder({ criteria, onChange }: SmartListCriteriaBuilderProps) {
  const addRule = () => {
    const newRule: CriteriaRule = {
      id: Math.random().toString(36).substr(2, 9),
      field: 'status',
      operator: 'equals',
      value: '',
    };
    onChange([...criteria, newRule]);
  };

  const updateRule = (id: string, updates: Partial<CriteriaRule>) => {
    const updatedCriteria = criteria.map(rule =>
      rule.id === id ? { ...rule, ...updates } : rule
    );
    onChange(updatedCriteria);
  };

  const removeRule = (id: string) => {
    const filteredCriteria = criteria.filter(rule => rule.id !== id);
    onChange(filteredCriteria);
  };

  const getOperatorsForField = (field: string) => {
    if (field === 'score') return OPERATORS.number;
    if (field === 'created_at') return OPERATORS.date;
    return OPERATORS.text;
  };

  const getValueInput = (rule: CriteriaRule) => {
    if (rule.field === 'status') {
      return (
        <Select value={rule.value} onValueChange={(value) => updateRule(rule.id, { value })}>
          <SelectTrigger>
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(status => (
              <SelectItem key={status} value={status}>{status}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (rule.field === 'source') {
      return (
        <Select value={rule.value} onValueChange={(value) => updateRule(rule.id, { value })}>
          <SelectTrigger>
            <SelectValue placeholder="Select source" />
          </SelectTrigger>
          <SelectContent>
            {SOURCE_OPTIONS.map(source => (
              <SelectItem key={source} value={source}>{source}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (rule.field === 'score') {
      return (
        <Input
          type="number"
          min="0"
          max="100"
          value={rule.value}
          onChange={(e) => updateRule(rule.id, { value: e.target.value })}
          placeholder="Enter score"
        />
      );
    }

    if (rule.field === 'created_at' && rule.operator === 'in_last_days') {
      return (
        <Input
          type="number"
          min="1"
          value={rule.value}
          onChange={(e) => updateRule(rule.id, { value: e.target.value })}
          placeholder="Number of days"
        />
      );
    }

    if (rule.field === 'created_at') {
      return (
        <Input
          type="date"
          value={rule.value}
          onChange={(e) => updateRule(rule.id, { value: e.target.value })}
        />
      );
    }

    return (
      <Input
        value={rule.value}
        onChange={(e) => updateRule(rule.id, { value: e.target.value })}
        placeholder="Enter value"
      />
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Smart List Criteria</CardTitle>
        <p className="text-sm text-muted-foreground">
          Define rules that automatically determine which leads belong to this list
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {criteria.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No criteria defined. Add rules to create a smart list.
          </div>
        )}

        {criteria.map((rule, index) => (
          <div key={rule.id} className="space-y-2">
            {index > 0 && (
              <div className="flex justify-center">
                <Badge variant="outline">AND</Badge>
              </div>
            )}
            <div className="grid grid-cols-12 gap-2 items-end">
              <div className="col-span-3">
                <Label className="text-xs">Field</Label>
                <Select
                  value={rule.field}
                  onValueChange={(value) => updateRule(rule.id, { 
                    field: value, 
                    operator: getOperatorsForField(value)[0].value,
                    value: ''
                  })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELDS.map(field => (
                      <SelectItem key={field.value} value={field.value}>
                        {field.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-3">
                <Label className="text-xs">Condition</Label>
                <Select
                  value={rule.operator}
                  onValueChange={(value) => updateRule(rule.id, { operator: value, value: '' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {getOperatorsForField(rule.field).map(operator => (
                      <SelectItem key={operator.value} value={operator.value}>
                        {operator.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-5">
                <Label className="text-xs">Value</Label>
                {getValueInput(rule)}
              </div>

              <div className="col-span-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRule(rule.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}

        <Button type="button" variant="outline" onClick={addRule} className="w-full">
          <Plus className="h-4 w-4 mr-2" />
          Add Rule
        </Button>

        {criteria.length > 0 && (
          <div className="pt-4 border-t">
            <Label className="text-sm font-medium">Preview</Label>
            <div className="text-sm text-muted-foreground mt-1">
              Leads that match{' '}
              <span className="font-medium">all</span> of the following criteria:
              <ul className="mt-2 space-y-1">
                {criteria.map((rule, index) => (
                  <li key={rule.id} className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {FIELDS.find(f => f.value === rule.field)?.label}
                    </Badge>
                    <span className="text-xs">
                      {getOperatorsForField(rule.field).find(op => op.value === rule.operator)?.label}
                    </span>
                    <span className="text-xs font-medium">"{rule.value}"</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}