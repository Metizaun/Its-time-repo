import { Zap } from "lucide-react";
interface CRMLogoProps {
  className?: string;
  showText?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "default" | "brand";
}
const CRMLogo = ({
  className,
  showText = true,
  size = "md",
  variant = "default"
}: CRMLogoProps) => {
  const sizeClasses = {
    sm: "p-1.5",
    md: "p-2",
    lg: "p-3"
  };
  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-6 h-6"
  };
  const textSizes = {
    sm: "text-lg",
    md: "text-xl",
    lg: "text-2xl"
  };
  const isBrand = variant === "brand";
  return <div className={`flex items-center gap-3 ${className || ""}`}>
      <div className={`${isBrand ? "bg-brand-light border border-brand-light/20 rounded-full" : "bg-background border border-border rounded-full"} ${sizeClasses[size]}`}>
        <Zap className={`${isBrand ? "text-brand-dark" : "text-foreground"} ${iconSizes[size]}`} />
      </div>
      {showText && <span className={`font-bold ${isBrand ? "text-white" : "text-foreground"} ${textSizes[size]}`}>Clear Control
    </span>}
    </div>;
};
export default CRMLogo;