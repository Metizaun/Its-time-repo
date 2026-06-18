import { Edit, Building, Globe, MapPin, Users, DollarSign, FileText, Mail, Phone } from "lucide-react";
import { Company } from "@/hooks/useCompanies";
import { EntityDetailDialog, DetailField, DetailList } from "@/components/ui/entity-detail-dialog";

interface CompanyDetailDialogProps {
  company: Company | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (company: Company) => void;
}

export function CompanyDetailDialog({
  company,
  open,
  onOpenChange,
  onEdit
}: CompanyDetailDialogProps) {
  if (!company) return null;

  const formatCurrency = (amount?: number) => {
    if (!amount) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatEmployeeCount = (count?: number) => {
    if (!count) return null;
    return count.toLocaleString();
  };

  const companyFields = [
    ...(company.website ? [{
      label: "Website",
      value: (
        <a
          href={company.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          {company.website}
        </a>
      ),
      icon: <Globe className="h-4 w-4" />
    }] : []),
    ...(company.email ? [{
      label: "Email",
      value: company.email,
      icon: <Mail className="h-4 w-4" />
    }] : []),
    ...(company.phone ? [{
      label: "Phone",
      value: company.phone,
      icon: <Phone className="h-4 w-4" />
    }] : []),
    ...(company.employee_count ? [{
      label: "Employees",
      value: `${formatEmployeeCount(company.employee_count)} employees`,
      icon: <Users className="h-4 w-4" />
    }] : []),
    ...(company.annual_revenue ? [{
      label: "Annual Revenue",
      value: formatCurrency(company.annual_revenue)!,
      icon: <DollarSign className="h-4 w-4" />
    }] : []),
  ];

  const addressParts = [company.city, company.state, company.postal_code].filter(Boolean);
  const addressFields = [
    ...(company.address ? [{
      label: "Address",
      value: company.address,
      icon: <MapPin className="h-4 w-4" />
    }] : []),
    ...(addressParts.length > 0 ? [{
      label: "Location",
      value: addressParts.join(', '),
      icon: <MapPin className="h-4 w-4" />
    }] : []),
    ...(company.country ? [{
      label: "Country",
      value: company.country,
      icon: <MapPin className="h-4 w-4" />
    }] : []),
  ];

  const sections = [
    {
      title: "Company Information",
      icon: <Building className="h-5 w-5" />,
      content: <DetailList items={companyFields} />,
      show: companyFields.length > 0
    },
    {
      title: "Address Information",
      icon: <MapPin className="h-5 w-5" />,
      content: <DetailList items={addressFields} />,
      show: addressFields.length > 0
    },
    {
      title: "Notes",
      icon: <FileText className="h-5 w-5" />,
      content: (
        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
          {company.notes}
        </p>
      ),
      show: !!company.notes
    }
  ];

  return (
    <EntityDetailDialog
      open={open}
      onOpenChange={onOpenChange}
      title={company.name}
      subtitle={company.industry || "Company Details"}
      avatar={{
        fallback: company.name.substring(0, 2).toUpperCase(),
        className: "h-16 w-16"
      }}
      editButton={{
        onClick: () => onEdit(company),
        label: "Edit"
      }}
      sections={sections}
      metadata={{
        customText: `Company added on ${new Date(company.created_at).toLocaleDateString()}`
      }}
    />
  );
}