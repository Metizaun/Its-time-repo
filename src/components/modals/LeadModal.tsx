import { useState, useEffect } from "react";
import { useLeadOperations } from "@/hooks/useLeadOperations";
import { useCrmUsers } from "@/hooks/useCrmUsers";
import { usePipelineStages } from "@/hooks/usePipelineStages";
import { useInstances } from "@/hooks/useInstances";
import { useAuth } from "@/contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  const { user } = useAuth();
  const { users, loading: usersLoading } = useCrmUsers();
  const { stages, loading: stagesLoading } = usePipelineStages();
  const { instances, loading: instancesLoading } = useInstances();
  const currentCrmUser = users.find((crmUser) => crmUser.auth_user_id === user?.id) ?? null;

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    contact_phone: "",
    source: "WhatsApp",
    last_city: "",
    stage_id: "",
    instancia: "",
    value: "",
    connection_level: "",
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
        instancia: "",
        value: "",
        connection_level: "",
        notes: "",
      });
    }
  }, [isOpen, stages]);

  useEffect(() => {
    if (!isOpen || formData.instancia || instances.length === 0) {
      return;
    }

    setFormData((prev) => ({
      ...prev,
      instancia: instances[0].instancia,
    }));
  }, [formData.instancia, instances, isOpen]);

  const dependenciesLoading = usersLoading || stagesLoading || instancesLoading;
  const canSubmit =
    !dependenciesLoading &&
    !!currentCrmUser &&
    stages.length > 0 &&
    instances.length > 0 &&
    !!formData.instancia;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentCrmUser) {
      return;
    }

    const { error } = await createLead({
      name: formData.name,
      email: formData.email,
      contact_phone: formData.contact_phone,
      source: formData.source,
      last_city: formData.last_city,
      stage_id: formData.stage_id,
      instancia: formData.instancia,
      value: formData.value ? parseFloat(formData.value) : undefined,
      connection_level: formData.connection_level || undefined,
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
          <DialogDescription>
            A instância escolhida define automaticamente o responsável do lead no banco. Aguarde o carregamento completo antes de salvar.
          </DialogDescription>
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
                disabled={stagesLoading || stages.length === 0}
              >
                <SelectTrigger id="stage_id">
                  <SelectValue
                    placeholder={
                      stagesLoading
                        ? "Carregando etapas"
                        : stages.length === 0
                          ? "Cadastre uma etapa"
                          : "Selecione a etapa"
                    }
                  />
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
              <Label htmlFor="instancia">Instancia *</Label>
              <Select
                value={formData.instancia}
                onValueChange={(value) => setFormData({ ...formData, instancia: value })}
                disabled={instancesLoading || instances.length === 0}
                required
              >
                <SelectTrigger id="instancia">
                  <SelectValue
                    placeholder={
                      instancesLoading
                        ? "Carregando instancias"
                        : instances.length === 0
                          ? "Cadastre uma instancia"
                          : "Selecione a instancia"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {instances.map((instance) => (
                    <SelectItem key={instance.instancia} value={instance.instancia}>
                      {instance.instancia}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!instancesLoading && instances.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Cadastre uma instancia antes de criar leads que precisam de comunicacao.
                </p>
              ) : null}
              {!instancesLoading && !currentCrmUser ? (
                <p className="text-xs text-destructive">
                  Nao foi possivel identificar o usuario CRM atual. Recarregue a pagina antes de criar um lead.
                </p>
              ) : null}
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
              <Input id="owner_id" value={formData.instancia ? `Definido pela instância: ${formData.instancia}` : ""} disabled />
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
            <Button type="submit" disabled={!canSubmit}>
              Criar Lead
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
