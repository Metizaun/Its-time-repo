import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface VendedorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function VendedorModal({ isOpen, onClose }: VendedorModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
  });

  useEffect(() => {
    if (!isOpen) {
      setFormData({
        name: "",
        email: "",
      });
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Esta funcionalidade está deprecada - usuários devem se registrar via Auth
    toast.info("Funcionalidade deprecada", {
      description: "Novos vendedores devem se registrar através da página de login"
    });
    
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md" aria-modal="true">
        <DialogHeader>
          <DialogTitle>Adicionar Vendedor (Deprecado)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Esta funcionalidade está deprecada. Novos vendedores devem se registrar através da 
            página de autenticação e aguardar aprovação do administrador.
          </p>
          
          <DialogFooter>
            <Button type="button" onClick={onClose}>
              Entendi
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
