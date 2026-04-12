import { useState, useEffect } from "react";
import { useLeadOperations } from "@/hooks/useLeadOperations";
import { useCrmUsers } from "@/hooks/useCrmUsers";
import { usePipelineStages } from "@/hooks/usePipelineStages";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface LeadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LeadModal({ isOpen, onClose }: LeadModalProps) {
  const { createLead } = useLeadOperations();
  const { users } = useCrmUsers();
  const { stages } = usePipelineStages();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    contact_phone: "",
    source: "WhatsApp",
    last_city: "",
    stage_id: "",
    value: "",
    connection_level: "",
    owner_id: "",
    notes: "",
  });

  useEffect(() => {
    if (isOpen && stages.length > 0 && !formData.stage_id) {
      setFormData((prev) => ({
        ...prev,
        stage_id: stages[0].id,
      }));
    }
  }, [isOpen, stages, formData.stage_id]);

  useEffect(() => {
    if (!isOpen) {
      setFormData({
        name: "",
        email: "",
        contact_phone: "",
        source: "WhatsApp",
        last_city: "",
        stage_id: stages.length > 0 ? stages[0].id : "",
        value: "",
        connection_level: "",
        owner_id: "",
        notes: "",
      });
    }
  }, [isOpen, stages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const selectedStage = stages.find((s) => s.id === formData.stage_id);
    const derivedStatus = selectedStage?.category || "Aberto";

    const { error } = await createLead({
      name: formData.name,
      email: formData.email,
      contact_phone: formData.contact_phone,
      source: formData.source,
      last_city: formData.last_city,
      status: derivedStatus,
      stage_id: formData.stage_id,
      value: formData.value ? parseFloat(formData.value) : undefined,
      connection_level: formData.connection_level || undefined,
      owner_id: formData.owner_id || undefined,
      notes: formData.notes || undefined,
    });

    if (!error) {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-modal="true">
        <DialogHeader>
          <DialogTitle>Novo Lead</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome *</Label>
              <Input
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="last_city">Cidade</Label>
              <Input
                id="last_city"
                value={formData.last_city}
                onChange={(e) => setFormData({ ...formData, last_city: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="contact_phone">Telefone *</Label>
              <Input
                id="contact_phone"
                required
                value={formData.contact_phone}
                onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
                placeholder="11987654321"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="source">Origem</Label>
              <Select
                value={formData.source}
                onValueChange={(value) => setFormData({ ...formData, source: value })}
              >
                <SelectTrigger id="source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WhatsApp">WhatsApp</SelectItem>
                  <SelectItem value="Instagram">Instagram</SelectItem>
                  <SelectItem value="Facebook">Facebook</SelectItem>
                  <SelectItem value="Google Ads">Google Ads</SelectItem>
                  <SelectItem value="Indicacao">Indicacao</SelectItem>
                  <SelectItem value="Outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stage_id">Etapa do Funil</Label>
              <Select
                value={formData.stage_id}
                onValueChange={(value) => {
                  setFormData({ ...formData, stage_id: value });
                }}
              >
                <SelectTrigger id="stage_id">
                  <SelectValue placeholder="Selecione a etapa" />
                </SelectTrigger>
                <SelectContent>
                  {stages.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="value">Valor (R$)</Label>
              <Input
                id="value"
                type="number"
                step="0.01"
                placeholder="0.00"
                value={formData.value}
                onChange={(e) => setFormData({ ...formData, value: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="connection_level">Nivel de Conexao</Label>
              <Select
                value={formData.connection_level}
                onValueChange={(value) => setFormData({ ...formData, connection_level: value })}
              >
                <SelectTrigger id="connection_level">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Baixa">Baixa</SelectItem>
                  <SelectItem value="Media">Media</SelectItem>
                  <SelectItem value="Alta">Alta</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="owner_id">Responsavel</Label>
              <Select
                value={formData.owner_id}
                onValueChange={(value) => setFormData({ ...formData, owner_id: value })}
              >
                <SelectTrigger id="owner_id">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Observacoes</Label>
            <Textarea
              id="notes"
              placeholder="Adicione observacoes sobre este lead..."
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit">Criar Lead</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
