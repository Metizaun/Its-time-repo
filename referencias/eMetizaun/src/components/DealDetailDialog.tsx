import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, DollarSign, Building2, User, Target, FileText, TrendingUp, Clock } from "lucide-react";
import { EntityDetailDialog, DetailField, DetailList } from "@/components/ui/entity-detail-dialog";

interface DealDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal: any | null;
  onEdit: () => void;
}

export function DealDetailDialog({ open, onOpenChange, deal, onEdit }: DealDetailDialogProps) {
  if (!deal) return null;

  const getStageColor = (stage: string) => {
    const colors = {
      "Lead": "bg-blue-100 text-blue-800",
      "Qualified": "bg-green-100 text-green-800",
      "Proposal": "bg-yellow-100 text-yellow-800",
      "Negotiation": "bg-orange-100 text-orange-800",
      "Closed Won": "bg-emerald-100 text-emerald-800",
      "Closed Lost": "bg-red-100 text-red-800"
    };
    return colors[stage as keyof typeof colors] || "bg-gray-100 text-gray-800";
  };

  const getProbabilityColor = (probability: number) => {
    if (probability >= 80) return "text-green-600";
    if (probability >= 50) return "text-yellow-600";
    if (probability >= 20) return "text-orange-600";
    return "text-red-600";
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return "Not set";
    return new Date(dateString).toLocaleDateString();
  };

  const dealFields = [
    {
      label: "Company",
      value: deal.company_id || "No company",
      icon: <Building2 className="h-4 w-4" />
    },
    {
      label: "Contact",
      value: deal.contact_id || "No contact",
      icon: <User className="h-4 w-4" />
    },
    {
      label: "Value",
      value: deal.value ? (
        <span className="text-lg font-semibold text-green-600">
          {formatCurrency(deal.value)}
        </span>
      ) : "Not set",
      icon: <DollarSign className="h-4 w-4" />
    },
    {
      label: "Stage",
      value: (
        <Badge className={getStageColor(deal.stage)}>
          {deal.stage}
        </Badge>
      ),
      icon: <Target className="h-4 w-4" />
    },
    {
      label: "Status",
      value: deal.status ? (
        <Badge variant="secondary">
          {deal.status}
        </Badge>
      ) : "Unknown",
      icon: <Target className="h-4 w-4" />
    },
    {
      label: "Probability",
      value: deal.probability !== undefined ? (
        <span className={`font-semibold ${getProbabilityColor(deal.probability)}`}>
          {deal.probability}%
        </span>
      ) : "Not set",
      icon: <TrendingUp className="h-4 w-4" />
    },
    {
      label: "Expected Close Date",
      value: formatDate(deal.expected_close_date),
      icon: <Calendar className="h-4 w-4" />
    },
    {
      label: "Actual Close Date",
      value: deal.actual_close_date ? formatDate(deal.actual_close_date) : "Not closed",
      icon: <Calendar className="h-4 w-4" />
    },
    {
      label: "Created",
      value: formatDate(deal.created_at),
      icon: <Clock className="h-4 w-4" />
    }
  ];

  const sections = [
    {
      title: "Deal Overview",
      icon: <Target className="h-5 w-5" />,
      content: <DetailList items={dealFields} />
    },
    ...(deal.description ? [{
      title: "Description",
      icon: <FileText className="h-5 w-5" />,
      content: (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {deal.description}
        </p>
      )
    }] : []),
    ...(deal.notes ? [{
      title: "Notes",
      icon: <FileText className="h-5 w-5" />,
      content: (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {deal.notes}
        </p>
      )
    }] : []),
    {
      title: "Recent Activities",
      icon: <Calendar className="h-5 w-5" />,
      content: deal.activities && deal.activities.length > 0 ? (
        <div className="space-y-3">
          {deal.activities.map((activity: any, index: number) => (
            <div key={index} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
              <div className="w-2 h-2 bg-primary rounded-full mt-2 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{activity.title}</p>
                <p className="text-sm text-muted-foreground">{activity.description}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDate(activity.date)}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6 text-muted-foreground">
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p>No activities recorded yet</p>
          <p className="text-sm">Activities and updates will appear here</p>
        </div>
      )
    },
    {
      title: "Deal Insights",
      icon: <TrendingUp className="h-5 w-5" />,
      content: (
        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm font-medium text-blue-900">Days in Pipeline</p>
            <p className="text-2xl font-bold text-blue-600">
              {Math.floor((new Date().getTime() - new Date(deal.created_at).getTime()) / (1000 * 3600 * 24))}
            </p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <p className="text-sm font-medium text-green-900">Expected Value</p>
            <p className="text-2xl font-bold text-green-600">
              {formatCurrency(deal.value * (deal.probability / 100))}
            </p>
          </div>
        </div>
      )
    }
  ];

  return (
    <EntityDetailDialog
      open={open}
      onOpenChange={onOpenChange}
      title={deal.title}
      subtitle="Deal Details"
      editButton={{
        onClick: onEdit,
        label: "Edit Deal"
      }}
      sections={sections}
      metadata={{
        createdAt: deal.created_at
      }}
    />
  );
}