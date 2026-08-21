import { FormEvent, useMemo, useState } from "react";
import { Building2, Loader2, MapPin, Pencil, Plus, Search, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Company, CompanyInput, useCompanies } from "@/hooks/useCompanies";
import { formatCnpj, isValidCnpj, normalizeCnpj } from "@/lib/cnpj";

const EMPTY_FORM: CompanyInput = {
  cnpj: "",
  legalName: "",
  name: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  timezone: "America/Sao_Paulo",
  searchAliases: [],
  isActive: true,
};

const BRAZIL_TIMEZONES = [
  { value: "America/Sao_Paulo", label: "Brasilia (UTC-3)" },
  { value: "America/Manaus", label: "Manaus (UTC-4)" },
  { value: "America/Cuiaba", label: "Cuiaba (UTC-4)" },
  { value: "America/Rio_Branco", label: "Rio Branco (UTC-5)" },
];

function companyMatchesSearch(company: Company, search: string) {
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  if (!normalizedSearch) return true;
  const digitsAndLetters = normalizeCnpj(search);
  return (
    company.name.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
    company.legalName.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
    company.city.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
    company.state.toLocaleLowerCase("pt-BR").includes(normalizedSearch) ||
    (digitsAndLetters.length > 0 && company.cnpj.includes(digitsAndLetters))
  );
}

export function CompanyManager() {
  const { companies, loading, saving, saveCompany } = useCompanies();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [form, setForm] = useState<CompanyInput>(EMPTY_FORM);
  const [searchAliasesText, setSearchAliasesText] = useState("");
  const [errors, setErrors] = useState<Partial<Record<keyof CompanyInput, string>>>({});

  const filteredCompanies = useMemo(
    () => companies.filter((company) => companyMatchesSearch(company, search)),
    [companies, search],
  );

  const openCreate = () => {
    setEditingCompany(null);
    setForm(EMPTY_FORM);
    setSearchAliasesText("");
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (company: Company) => {
    setEditingCompany(company);
    setForm({
      cnpj: company.cnpj,
      legalName: company.legalName,
      name: company.name,
      phone: company.phone ?? "",
      email: company.email ?? "",
      address: company.address,
      city: company.city,
      state: company.state,
      postalCode: company.postalCode ?? "",
      timezone: company.timezone,
      searchAliases: company.searchAliases,
      isActive: company.isActive,
    });
    setSearchAliasesText(company.searchAliases.join("\n"));
    setErrors({});
    setDialogOpen(true);
  };

  const validate = () => {
    const nextErrors: Partial<Record<keyof CompanyInput, string>> = {};
    if (!isValidCnpj(form.cnpj)) nextErrors.cnpj = "Informe um CNPJ válido.";
    if (!form.legalName.trim()) nextErrors.legalName = "Informe a razão social.";
    if (!form.name.trim()) nextErrors.name = "Informe o nome fantasia.";
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextErrors.email = "Informe um e-mail válido.";
    }
    if (!form.address.trim()) nextErrors.address = "Informe o endereço.";
    if (!form.city.trim()) nextErrors.city = "Informe a cidade.";
    if (!/^[A-Za-z]{2}$/.test(form.state.trim())) nextErrors.state = "Use a sigla do estado.";
    if (form.postalCode.trim() && form.postalCode.replace(/\D/g, "").length !== 8) {
      nextErrors.postalCode = "Informe um CEP com 8 dígitos.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validate()) return;
    const success = await saveCompany(
      {
        ...form,
        cnpj: normalizeCnpj(form.cnpj),
        legalName: form.legalName.trim(),
        name: form.name.trim(),
        phone: form.phone.trim(),
        email: form.email.trim().toLowerCase(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        postalCode: form.postalCode.replace(/\D/g, ""),
        searchAliases: searchAliasesText
          .split(/[\n,]/)
          .map((value) => value.trim())
          .filter(Boolean),
      },
      editingCompany?.id,
    );
    if (success) setDialogOpen(false);
  };

  return (
    <Card className="overflow-hidden border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
      <div className="flex flex-col gap-4 border-b border-[var(--border-default)] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-[var(--color-gray-900)]">
            <Building2 />
            Empresas
          </h2>
          <p className="mt-1 text-sm text-[var(--color-gray-500)]">
            Unidades usadas no acesso, na agenda e no encaminhamento.
          </p>
        </div>
        <Button onClick={openCreate} className="shadow-primary">
          <Plus />
          Nova empresa
        </Button>
      </div>

      <div className="p-6">
        <div className="relative mb-5 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-gray-500)]" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, CNPJ ou cidade"
            className="pl-10 shadow-inset"
          />
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-16 w-full" />
            ))}
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="flex flex-col items-center py-14 text-center">
            <Building2 className="mb-4 h-12 w-12 text-[var(--color-primary-500)]" />
            <h3 className="text-lg font-semibold text-[var(--color-gray-900)]">
              {companies.length === 0 ? "Nenhuma empresa cadastrada" : "Nenhuma empresa encontrada"}
            </h3>
            <p className="mt-1 max-w-sm text-sm text-[var(--color-gray-500)]">
              {companies.length === 0
                ? "Cadastre a primeira empresa para organizar acessos e atendimentos."
                : "Tente buscar por outro nome, CNPJ ou cidade."}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead>CNPJ</TableHead>
                    <TableHead>Localização</TableHead>
                    <TableHead>Usuários</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCompanies.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium text-[var(--color-gray-900)]">
                        {company.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatCnpj(company.cnpj)}
                      </TableCell>
                      <TableCell>{company.city}/{company.state}</TableCell>
                      <TableCell>{company.memberCount}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className={`h-2 w-2 rounded-full ${
                              company.isActive
                                ? "bg-[var(--color-success-500)]"
                                : "bg-[var(--color-gray-400)]"
                            }`}
                          />
                          {company.isActive ? "Ativa" : "Inativa"}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(company)}>
                          <Pencil />
                          Editar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3 sm:hidden">
              {filteredCompanies.map((company) => (
                <button
                  type="button"
                  key={company.id}
                  onClick={() => openEdit(company)}
                  className="w-full rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--color-surface-1)] p-4 text-left shadow-sm transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md focus-visible:shadow-focus"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-semibold text-[var(--color-gray-900)]">
                        {company.name}
                      </span>
                      <span className="mt-1 block font-mono text-xs text-[var(--color-gray-500)]">
                        {formatCnpj(company.cnpj)}
                      </span>
                    </span>
                    <Pencil className="text-[var(--color-gray-500)]" />
                  </span>
                  <span className="mt-4 flex items-center gap-4 text-sm text-[var(--color-gray-600)]">
                    <span className="inline-flex items-center gap-1"><MapPin />{company.city}/{company.state}</span>
                    <span className="inline-flex items-center gap-1"><Users />{company.memberCount}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto shadow-modal">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editingCompany ? "Editar empresa" : "Nova empresa"}</DialogTitle>
              <DialogDescription>
                Cadastre somente os dados necessários para identificar a unidade.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-5 py-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company-cnpj">CNPJ</Label>
                <Input
                  id="company-cnpj"
                  value={formatCnpj(form.cnpj)}
                  onChange={(event) => setForm((current) => ({ ...current, cnpj: event.target.value }))}
                  placeholder="00.000.000/0000-00"
                  autoComplete="off"
                  aria-invalid={Boolean(errors.cnpj)}
                  className="font-mono uppercase shadow-inset"
                />
                {errors.cnpj ? <p className="text-xs text-[var(--color-error-600)]">{errors.cnpj}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-legal-name">Razão social</Label>
                <Input
                  id="company-legal-name"
                  value={form.legalName}
                  onChange={(event) => setForm((current) => ({ ...current, legalName: event.target.value }))}
                  aria-invalid={Boolean(errors.legalName)}
                  className="shadow-inset"
                />
                {errors.legalName ? <p className="text-xs text-[var(--color-error-600)]">{errors.legalName}</p> : null}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="company-name">Nome fantasia</Label>
                <Input
                  id="company-name"
                  value={form.name}
                  onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                  aria-invalid={Boolean(errors.name)}
                  className="shadow-inset"
                />
                {errors.name ? <p className="text-xs text-[var(--color-error-600)]">{errors.name}</p> : null}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="company-search-aliases">Nomes alternativos para busca</Label>
                <Textarea
                  id="company-search-aliases"
                  value={searchAliasesText}
                  onChange={(event) => setSearchAliasesText(event.target.value)}
                  placeholder={"Um nome por linha, como Campo Largo\nSaúde Perfeita Campo Largo"}
                  className="min-h-20 resize-y shadow-inset"
                />
                <p className="text-xs text-[var(--color-gray-500)]">
                  A IA combina estes nomes com os dados oficiais cadastrados para reconhecer a unidade.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-phone">Telefone</Label>
                <Input
                  id="company-phone"
                  value={form.phone}
                  onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
                  inputMode="tel"
                  autoComplete="tel"
                  className="shadow-inset"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-email">E-mail</Label>
                <Input
                  id="company-email"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                  className="shadow-inset"
                />
                {errors.email ? <p className="text-xs text-[var(--color-error-600)]">{errors.email}</p> : null}
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="company-address">Endereço</Label>
                <Input
                  id="company-address"
                  value={form.address}
                  onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
                  placeholder="Rua, número e complemento"
                  aria-invalid={Boolean(errors.address)}
                  className="shadow-inset"
                />
                {errors.address ? <p className="text-xs text-[var(--color-error-600)]">{errors.address}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-postal-code">CEP</Label>
                <Input
                  id="company-postal-code"
                  value={form.postalCode}
                  onChange={(event) => setForm((current) => ({
                    ...current,
                    postalCode: event.target.value.replace(/\D/g, "").slice(0, 8),
                  }))}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  aria-invalid={Boolean(errors.postalCode)}
                  className="font-mono shadow-inset"
                />
                {errors.postalCode ? <p className="text-xs text-[var(--color-error-600)]">{errors.postalCode}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-city">Cidade</Label>
                <Input
                  id="company-city"
                  value={form.city}
                  onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
                  aria-invalid={Boolean(errors.city)}
                  className="shadow-inset"
                />
                {errors.city ? <p className="text-xs text-[var(--color-error-600)]">{errors.city}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="company-state">Estado</Label>
                <Input
                  id="company-state"
                  value={form.state}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      state: event.target.value.replace(/[^a-z]/gi, "").slice(0, 2).toUpperCase(),
                    }))
                  }
                  placeholder="UF"
                  aria-invalid={Boolean(errors.state)}
                  className="uppercase shadow-inset"
                />
                {errors.state ? <p className="text-xs text-[var(--color-error-600)]">{errors.state}</p> : null}
              </div>
              <div className="space-y-2">
                <Label>Fuso horário</Label>
                <Select
                  value={form.timezone}
                  onValueChange={(timezone) => setForm((current) => ({ ...current, timezone }))}
                >
                  <SelectTrigger className="shadow-inset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BRAZIL_TIMEZONES.map((timezone) => (
                      <SelectItem key={timezone.value} value={timezone.value}>
                        {timezone.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-3 sm:col-span-2">
                <Switch
                  id="company-active"
                  checked={form.isActive}
                  onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))}
                />
                <Label htmlFor="company-active" className="font-normal">Empresa ativa</Label>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
                Cancelar
              </Button>
              <Button type="submit" disabled={saving} className="shadow-primary">
                {saving ? <Loader2 className="animate-spin" /> : null}
                {editingCompany ? "Salvar alterações" : "Criar empresa"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
