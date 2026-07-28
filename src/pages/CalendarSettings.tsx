import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BriefcaseMedical,
  Building2,
  CalendarClock,
  Clock3,
  Loader2,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  UserRound,
} from "lucide-react";
import { Link, Navigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import {
  AvailabilityException,
  ProfessionalLocation,
  useCalendarConfiguration,
} from "@/hooks/useCalendarConfiguration";
import {
  formatInCalendarTimezone,
  toZonedDateInput,
  toZonedTimeInput,
  zonedDateTimeToUtc,
} from "@/lib/calendarTimezone";

const WEEKDAYS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
];

const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function formatCurrency(priceCents: number | null) {
  if (priceCents === null) return "Preço não informado";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    priceCents / 100,
  );
}

function toLocalDateTimeInput(value: Date, timezone: string) {
  return `${toZonedDateInput(value, timezone)}T${toZonedTimeInput(value, timezone)}`;
}

function dateTimeInputToUtc(value: string, timezone: string) {
  const [date, time] = value.split("T");
  return zonedDateTimeToUtc(date, time, timezone).toISOString();
}

export default function CalendarSettings() {
  const { userRole, acesId } = useAuth();
  const configuration = useCalendarConfiguration(acesId, userRole === "ADMIN");
  const [professionalDialogOpen, setProfessionalDialogOpen] = useState(false);
  const [editingProfessionalId, setEditingProfessionalId] = useState<string | null>(null);
  const [serviceDialogOpen, setServiceDialogOpen] = useState(false);
  const [serviceOverrideDialogOpen, setServiceOverrideDialogOpen] = useState(false);
  const [professionalForm, setProfessionalForm] = useState({
    name: "",
    specialty: "",
    companyIds: [] as string[],
    independentLocationName: "Atendimento independente",
    serviceIds: [] as string[],
  });
  const [serviceForm, setServiceForm] = useState({
    name: "",
    description: "",
    durationMinutes: 30,
    price: "",
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
  });
  const [serviceOverrideForm, setServiceOverrideForm] = useState({
    bindingId: "",
    locationLabel: "",
    serviceName: "",
    durationMinutes: "",
    price: "",
    bufferBeforeMinutes: "",
    bufferAfterMinutes: "",
  });
  const [generalForm, setGeneralForm] = useState({
    timezone: "America/Sao_Paulo",
    minimumNoticeMinutes: 60,
    bookingHorizonDays: 90,
    slotIntervalMinutes: 15,
    aiBookingEnabled: false,
  });
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [availabilityForm, setAvailabilityForm] = useState({
    weekdays: [1] as number[],
    startTime: "08:00",
    endTime: "18:00",
  });
  const initialBlockStart = useMemo(() => {
    const start = new Date();
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    return start;
  }, []);
  const [exceptionForm, setExceptionForm] = useState({
    scope: "account",
    exceptionType: "block" as AvailabilityException["exception_type"],
    startsAt: toLocalDateTimeInput(initialBlockStart, "America/Sao_Paulo"),
    endsAt: toLocalDateTimeInput(new Date(initialBlockStart.getTime() + 60 * 60_000), "America/Sao_Paulo"),
    reason: "",
  });

  useEffect(() => {
    if (!configuration.settings) return;
    setGeneralForm({
      timezone: configuration.settings.timezone,
      minimumNoticeMinutes: configuration.settings.minimum_notice_minutes,
      bookingHorizonDays: configuration.settings.booking_horizon_days,
      slotIntervalMinutes: configuration.settings.slot_interval_minutes,
      aiBookingEnabled: configuration.settings.ai_booking_enabled,
    });
  }, [configuration.settings]);

  useEffect(() => {
    const active = configuration.locations.filter((location) => location.is_active);
    if (!active.some((location) => location.id === selectedLocationId)) {
      setSelectedLocationId(active[0]?.id ?? "");
    }
  }, [configuration.locations, selectedLocationId]);

  const companiesById = useMemo(
    () => new Map(configuration.companies.map((company) => [company.id, company])),
    [configuration.companies],
  );
  const professionalsById = useMemo(
    () => new Map(configuration.professionals.map((professional) => [professional.id, professional])),
    [configuration.professionals],
  );
  const activeLocations = useMemo(
    () => configuration.locations.filter((location) => location.is_active),
    [configuration.locations],
  );

  const locationLabel = (location: ProfessionalLocation) => {
    const professional = professionalsById.get(location.professional_id);
    const company = location.empresa_id ? companiesById.get(location.empresa_id) : null;
    return `${professional?.name ?? "Profissional"} — ${company?.name ?? location.location_name ?? "Independente"}`;
  };

  if (userRole !== "ADMIN") return <Navigate to="/calendar" replace />;

  const submitProfessional = async (event: FormEvent) => {
    event.preventDefault();
    if (!professionalForm.name.trim()) return;
    const success = editingProfessionalId
      ? await configuration.updateProfessional(editingProfessionalId, professionalForm)
      : await configuration.createProfessional(professionalForm);
    if (success) {
      setProfessionalForm({
        name: "",
        specialty: "",
        companyIds: [],
        independentLocationName: "Atendimento independente",
        serviceIds: [],
      });
      setProfessionalDialogOpen(false);
      setEditingProfessionalId(null);
    }
  };

  const openNewProfessional = () => {
    setEditingProfessionalId(null);
    setProfessionalForm({
      name: "",
      specialty: "",
      companyIds: [],
      independentLocationName: "Atendimento independente",
      serviceIds: [],
    });
    setProfessionalDialogOpen(true);
  };

  const openEditProfessional = (professional: typeof configuration.professionals[number]) => {
    const currentLocations = configuration.locations.filter(
      (location) => location.professional_id === professional.id && location.is_active,
    );
    setEditingProfessionalId(professional.id);
    const currentLocationIds = new Set(currentLocations.map((location) => location.id));
    setProfessionalForm({
      name: professional.name,
      specialty: professional.specialty ?? "",
      companyIds: currentLocations.flatMap((location) => location.empresa_id ? [location.empresa_id] : []),
      independentLocationName: currentLocations.find((location) => location.empresa_id === null)?.location_name
        ?? "Atendimento independente",
      serviceIds: [...new Set(configuration.professionalServices
        .filter((binding) => binding.is_active && currentLocationIds.has(binding.professional_location_id))
        .map((binding) => binding.service_id))],
    });
    setProfessionalDialogOpen(true);
  };

  const submitService = async (event: FormEvent) => {
    event.preventDefault();
    if (!serviceForm.name.trim()) return;
    const normalizedPrice = serviceForm.price.replace(/[^0-9,.-]/g, "").replace(",", ".");
    const priceNumber = normalizedPrice ? Number(normalizedPrice) : null;
    const success = await configuration.createService({
      name: serviceForm.name,
      description: serviceForm.description,
      durationMinutes: serviceForm.durationMinutes,
      priceCents: priceNumber === null || Number.isNaN(priceNumber) ? null : Math.round(priceNumber * 100),
      bufferBeforeMinutes: serviceForm.bufferBeforeMinutes,
      bufferAfterMinutes: serviceForm.bufferAfterMinutes,
    });
    if (success) {
      setServiceForm({
        name: "",
        description: "",
        durationMinutes: 30,
        price: "",
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
      });
      setServiceDialogOpen(false);
    }
  };

  const openServiceOverrides = (
    binding: typeof configuration.professionalServices[number],
    service: typeof configuration.services[number],
    location: ProfessionalLocation,
  ) => {
    setServiceOverrideForm({
      bindingId: binding.id,
      locationLabel: locationLabel(location),
      serviceName: service.name,
      durationMinutes: binding.duration_minutes_override?.toString() ?? "",
      price: binding.price_cents_override === null ? "" : (binding.price_cents_override / 100).toFixed(2).replace(".", ","),
      bufferBeforeMinutes: binding.buffer_before_minutes_override?.toString() ?? "",
      bufferAfterMinutes: binding.buffer_after_minutes_override?.toString() ?? "",
    });
    setServiceOverrideDialogOpen(true);
  };

  const submitServiceOverrides = async (event: FormEvent) => {
    event.preventDefault();
    const optionalInteger = (value: string) => value.trim() ? Number(value) : null;
    const priceText = serviceOverrideForm.price.replace(/[^0-9,.-]/g, "").replace(",", ".");
    const priceNumber = priceText ? Number(priceText) : null;
    const success = await configuration.saveProfessionalServiceOverrides(
      serviceOverrideForm.bindingId,
      {
        durationMinutes: optionalInteger(serviceOverrideForm.durationMinutes),
        priceCents: priceNumber === null || Number.isNaN(priceNumber) ? null : Math.round(priceNumber * 100),
        bufferBeforeMinutes: optionalInteger(serviceOverrideForm.bufferBeforeMinutes),
        bufferAfterMinutes: optionalInteger(serviceOverrideForm.bufferAfterMinutes),
      },
    );
    if (success) setServiceOverrideDialogOpen(false);
  };

  const submitAvailability = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedLocationId) return;
    await configuration.createAvailabilityRules({
      professionalLocationId: selectedLocationId,
      weekdays: availabilityForm.weekdays,
      startTime: availabilityForm.startTime,
      endTime: availabilityForm.endTime,
    });
  };

  const submitException = async (event: FormEvent) => {
    event.preventDefault();
    const [scopeType, scopeId] = exceptionForm.scope.split(":");
    await configuration.createException({
      empresaId: scopeType === "company" ? scopeId : null,
      professionalLocationId: scopeType === "location" ? scopeId : null,
      exceptionType: exceptionForm.exceptionType,
      startsAt: dateTimeInputToUtc(exceptionForm.startsAt, generalForm.timezone),
      endsAt: dateTimeInputToUtc(exceptionForm.endsAt, generalForm.timezone),
      reason: exceptionForm.reason,
    });
  };

  if (configuration.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <Skeleton className="h-96 w-full rounded-[var(--radius-xl)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-3">
            <Link to="/calendar"><ArrowLeft />Voltar ao calendário</Link>
          </Button>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-[var(--color-gray-900)]">
            <Settings2 />
            Configurar agenda
          </h1>
          <p className="mt-1 text-[var(--color-gray-500)]">
            Profissionais, serviços, horários e bloqueios.
          </p>
        </div>
      </header>

      <Tabs defaultValue="professionals" className="space-y-6">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto bg-[var(--color-bg-subtle)] p-1">
          <TabsTrigger value="professionals" className="gap-2"><UserRound />Profissionais</TabsTrigger>
          <TabsTrigger value="services" className="gap-2"><BriefcaseMedical />Serviços</TabsTrigger>
          <TabsTrigger value="availability" className="gap-2"><Clock3 />Horários</TabsTrigger>
          <TabsTrigger value="exceptions" className="gap-2"><CalendarClock />Bloqueios</TabsTrigger>
          <TabsTrigger value="general" className="gap-2"><Settings2 />Geral</TabsTrigger>
        </TabsList>

        <TabsContent value="professionals" className="mt-0">
          <Card className="overflow-hidden border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] p-6">
              <div>
                <h2 className="text-xl font-semibold text-[var(--color-gray-900)]">Profissionais</h2>
                <p className="mt-1 text-sm text-[var(--color-gray-500)]">Um profissional pode atender em várias empresas.</p>
              </div>
              <Button onClick={openNewProfessional} className="shadow-primary"><Plus />Adicionar</Button>
            </div>
            <div className="divide-y divide-[var(--border-default)]">
              {configuration.professionals.length === 0 ? (
                <p className="p-10 text-center text-sm text-[var(--color-gray-500)]">Nenhum profissional cadastrado.</p>
              ) : configuration.professionals.map((professional) => {
                const professionalLocations = configuration.locations.filter(
                  (location) => location.professional_id === professional.id && location.is_active,
                );
                return (
                  <div key={professional.id} className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold text-[var(--color-gray-900)]">{professional.name}</p>
                      {professional.specialty ? <p className="text-sm text-[var(--color-gray-500)]">{professional.specialty}</p> : null}
                      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--color-gray-600)]">
                        {professionalLocations.map((location) => (
                          <span key={location.id} className="inline-flex items-center gap-1">
                            <Building2 />
                            {location.empresa_id
                              ? companiesById.get(location.empresa_id)?.name
                              : location.location_name}
                          </span>
                        ))}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Button type="button" variant="outline" size="sm" onClick={() => openEditProfessional(professional)}>
                        <Pencil className="h-3.5 w-3.5" />
                        Editar
                      </Button>
                      <Label htmlFor={`professional-${professional.id}`} className="font-normal">
                        {professional.is_active ? "Ativo" : "Pausado"}
                      </Label>
                      <Switch
                        id={`professional-${professional.id}`}
                        checked={professional.is_active}
                        disabled={configuration.saving}
                        onCheckedChange={(checked) =>
                          void configuration.setProfessionalActive(professional.id, checked)
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="services" className="mt-0">
          <Card className="overflow-hidden border-[var(--border-default)] bg-[var(--color-surface-1)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border-default)] p-6">
              <div>
                <h2 className="text-xl font-semibold text-[var(--color-gray-900)]">Serviços</h2>
                <p className="mt-1 text-sm text-[var(--color-gray-500)]">Defina duração, valor e quem pode realizar.</p>
              </div>
              <Button onClick={() => setServiceDialogOpen(true)} className="shadow-primary"><Plus />Adicionar</Button>
            </div>
            <div className="divide-y divide-[var(--border-default)]">
              {configuration.services.length === 0 ? (
                <p className="p-10 text-center text-sm text-[var(--color-gray-500)]">Nenhum serviço cadastrado.</p>
              ) : configuration.services.map((service) => (
                <div key={service.id} className="p-6">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-semibold text-[var(--color-gray-900)]">{service.name}</p>
                      <p className="text-sm text-[var(--color-gray-500)]">
                        {service.duration_minutes} min · {formatCurrency(service.price_cents)}
                      </p>
                    </div>
                    <p className="text-sm text-[var(--color-gray-500)]">
                      Intervalo: {service.buffer_before_minutes + service.buffer_after_minutes} min
                    </p>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {activeLocations.map((location) => {
                      const binding = configuration.professionalServices.find(
                        (item) => item.professional_location_id === location.id && item.service_id === service.id,
                      );
                      const checked = Boolean(binding?.is_active);
                      const hasOverride = Boolean(binding && (
                        binding.duration_minutes_override !== null
                        || binding.price_cents_override !== null
                        || binding.buffer_before_minutes_override !== null
                        || binding.buffer_after_minutes_override !== null
                      ));
                      return (
                        <div key={location.id} className="flex items-center gap-1 rounded-[var(--radius-md)] p-1 hover:bg-[var(--color-bg-subtle)]">
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 p-1 text-sm">
                            <Checkbox
                              checked={checked}
                              disabled={configuration.saving}
                              onCheckedChange={(next) =>
                                void configuration.toggleProfessionalService(location.id, service.id, next === true)
                              }
                            />
                            <span className="min-w-0 flex-1 truncate">{locationLabel(location)}</span>
                            {hasOverride ? <span className="text-xs text-[var(--color-primary-700)]">Personalizado</span> : null}
                          </label>
                          {checked && binding ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => openServiceOverrides(binding, service, location)}
                              aria-label={`Ajustar ${service.name} para ${locationLabel(location)}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="availability" className="mt-0">
          <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-[var(--color-gray-900)]">Horários de atendimento</h2>
            <div className="mt-5 max-w-xl space-y-2">
              <Label>Profissional e local</Label>
              <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                <SelectTrigger className="shadow-inset"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {activeLocations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>{locationLabel(location)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <form onSubmit={submitAvailability} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label>Dias de atendimento</Label>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Dias de atendimento">
                  {WEEKDAY_SHORT.map((day, weekday) => {
                    const selected = availabilityForm.weekdays.includes(weekday);
                    return (
                      <Button
                        key={day}
                        type="button"
                        size="sm"
                        variant={selected ? "default" : "outline"}
                        aria-pressed={selected}
                        onClick={() => setAvailabilityForm((current) => ({
                          ...current,
                          weekdays: selected
                            ? current.weekdays.filter((value) => value !== weekday)
                            : [...current.weekdays, weekday].sort(),
                        }))}
                        className="min-w-12 rounded-full"
                      >
                        {day}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_auto]">
                <div className="space-y-2"><Label htmlFor="availability-start">Início</Label><Input id="availability-start" type="time" value={availabilityForm.startTime} onChange={(event) => setAvailabilityForm((current) => ({ ...current, startTime: event.target.value }))} className="shadow-inset" /></div>
                <div className="space-y-2"><Label htmlFor="availability-end">Fim</Label><Input id="availability-end" type="time" value={availabilityForm.endTime} onChange={(event) => setAvailabilityForm((current) => ({ ...current, endTime: event.target.value }))} className="shadow-inset" /></div>
                <Button type="submit" disabled={!selectedLocationId || availabilityForm.weekdays.length === 0 || configuration.saving} className="shadow-primary">{configuration.saving ? <Loader2 className="animate-spin" /> : <Plus />}Aplicar aos {availabilityForm.weekdays.length} {availabilityForm.weekdays.length === 1 ? "dia" : "dias"}</Button>
              </div>
            </form>

            <div className="mt-8 divide-y divide-[var(--border-default)]">
              {WEEKDAYS.map((day, weekday) => {
                const rules = configuration.availabilityRules.filter(
                  (rule) => rule.professional_location_id === selectedLocationId && rule.weekday === weekday,
                );
                return (
                  <div key={day} className="flex min-h-14 items-center justify-between gap-4 py-3">
                    <span className="w-36 font-medium text-[var(--color-gray-700)]">{day}</span>
                    <span className="flex flex-1 flex-wrap gap-3 text-sm text-[var(--color-gray-600)]">
                      {rules.length === 0 ? "Fechado" : rules.map((rule) => (
                        <span key={rule.id} className="inline-flex items-center gap-1">
                          {rule.start_time.slice(0, 5)}–{rule.end_time.slice(0, 5)}
                          <Button type="button" variant="ghost" size="icon" onClick={() => void configuration.removeAvailabilityRule(rule.id)} aria-label="Remover período"><Trash2 /></Button>
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="exceptions" className="mt-0">
          <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-[var(--color-gray-900)]">Pausas, feriados e bloqueios</h2>
            <form onSubmit={submitException} className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Label>Aplicar em</Label>
                <Select value={exceptionForm.scope} onValueChange={(value) => setExceptionForm((current) => ({ ...current, scope: value }))}>
                  <SelectTrigger className="shadow-inset"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="account">Toda a agenda</SelectItem>
                    {configuration.companies.map((company) => <SelectItem key={company.id} value={`company:${company.id}`}>{company.name}</SelectItem>)}
                    {activeLocations.map((location) => <SelectItem key={location.id} value={`location:${location.id}`}>{locationLabel(location)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select value={exceptionForm.exceptionType} onValueChange={(value) => setExceptionForm((current) => ({ ...current, exceptionType: value as AvailabilityException["exception_type"] }))}>
                  <SelectTrigger className="shadow-inset"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="block">Bloqueio</SelectItem><SelectItem value="pause">Pausa</SelectItem><SelectItem value="holiday">Feriado</SelectItem><SelectItem value="vacation">Férias</SelectItem></SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label htmlFor="block-start">Início</Label><Input id="block-start" type="datetime-local" value={exceptionForm.startsAt} onChange={(event) => setExceptionForm((current) => ({ ...current, startsAt: event.target.value }))} className="shadow-inset" /></div>
              <div className="space-y-2"><Label htmlFor="block-end">Fim</Label><Input id="block-end" type="datetime-local" value={exceptionForm.endsAt} onChange={(event) => setExceptionForm((current) => ({ ...current, endsAt: event.target.value }))} className="shadow-inset" /></div>
              <div className="space-y-2 lg:col-span-2"><Label htmlFor="block-reason">Motivo</Label><Input id="block-reason" value={exceptionForm.reason} onChange={(event) => setExceptionForm((current) => ({ ...current, reason: event.target.value }))} className="shadow-inset" /></div>
              <div className="lg:col-span-2"><Button type="submit" disabled={configuration.saving} className="shadow-primary">{configuration.saving ? <Loader2 className="animate-spin" /> : <Plus />}Adicionar bloqueio</Button></div>
            </form>

            <div className="mt-8 divide-y divide-[var(--border-default)]">
              {configuration.exceptions.length === 0 ? <p className="py-8 text-center text-sm text-[var(--color-gray-500)]">Nenhum bloqueio futuro.</p> : configuration.exceptions.map((exception) => (
                <div key={exception.id} className="flex items-center justify-between gap-4 py-4">
                  <div><p className="font-medium text-[var(--color-gray-800)]">{exception.reason || "Agenda indisponível"}</p><p className="text-sm text-[var(--color-gray-500)]">{formatInCalendarTimezone(exception.starts_at, generalForm.timezone, { dateStyle: "short", timeStyle: "short" })} até {formatInCalendarTimezone(exception.ends_at, generalForm.timezone, { dateStyle: "short", timeStyle: "short" })}</p></div>
                  <Button variant="ghost" size="icon" onClick={() => void configuration.removeException(exception.id)} aria-label="Remover bloqueio"><Trash2 /></Button>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="general" className="mt-0">
          <Card className="border-[var(--border-default)] bg-[var(--color-surface-1)] p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-[var(--color-gray-900)]">Regras gerais</h2>
            <form onSubmit={(event) => { event.preventDefault(); void configuration.saveSettings({ timezone: generalForm.timezone, minimum_notice_minutes: generalForm.minimumNoticeMinutes, booking_horizon_days: generalForm.bookingHorizonDays, slot_interval_minutes: generalForm.slotIntervalMinutes, ai_booking_enabled: generalForm.aiBookingEnabled }); }} className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="calendar-timezone">Fuso horário</Label><Input id="calendar-timezone" value={generalForm.timezone} onChange={(event) => setGeneralForm((current) => ({ ...current, timezone: event.target.value }))} className="shadow-inset" /></div>
              <div className="space-y-2"><Label>Oferecer horários a cada</Label><Select value={String(generalForm.slotIntervalMinutes)} onValueChange={(value) => setGeneralForm((current) => ({ ...current, slotIntervalMinutes: Number(value) }))}><SelectTrigger className="shadow-inset"><SelectValue /></SelectTrigger><SelectContent>{[5, 10, 15, 20, 30, 60].map((minutes) => <SelectItem key={minutes} value={String(minutes)}>{minutes} minutos</SelectItem>)}</SelectContent></Select><p className="text-xs text-[var(--color-gray-500)]">Define o início dos horários oferecidos. A pausa entre atendimentos é configurada no serviço e pode ser 0.</p></div>
              <div className="space-y-2"><Label htmlFor="minimum-notice">Antecedência mínima</Label><Input id="minimum-notice" type="number" min={0} value={generalForm.minimumNoticeMinutes} onChange={(event) => setGeneralForm((current) => ({ ...current, minimumNoticeMinutes: Number(event.target.value) }))} className="shadow-inset" /></div>
              <div className="space-y-2"><Label htmlFor="booking-horizon">Dias disponíveis no futuro</Label><Input id="booking-horizon" type="number" min={1} max={730} value={generalForm.bookingHorizonDays} onChange={(event) => setGeneralForm((current) => ({ ...current, bookingHorizonDays: Number(event.target.value) }))} className="shadow-inset" /></div>
              <div className="flex items-center gap-3 sm:col-span-2"><Switch id="ai-booking" checked={generalForm.aiBookingEnabled} onCheckedChange={(checked) => setGeneralForm((current) => ({ ...current, aiBookingEnabled: checked }))} /><div><Label htmlFor="ai-booking">Permitir agendamento pela IA</Label><p className="text-sm text-[var(--color-gray-500)]">A Tool do agente ainda precisa estar habilitada.</p></div></div>
              <div className="sm:col-span-2"><Button type="submit" disabled={configuration.saving} className="shadow-primary">{configuration.saving ? <Loader2 className="animate-spin" /> : null}Salvar regras</Button></div>
            </form>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={professionalDialogOpen} onOpenChange={(open) => {
        setProfessionalDialogOpen(open);
        if (!open) setEditingProfessionalId(null);
      }}>
        <DialogContent className="max-w-xl shadow-modal">
          <form onSubmit={submitProfessional}>
            <DialogHeader>
              <DialogTitle>{editingProfessionalId ? "Editar profissional" : "Adicionar profissional"}</DialogTitle>
              <DialogDescription>Escolha todas as empresas em que essa pessoa atende. Sem empresa, ela funciona como profissional independente.</DialogDescription>
            </DialogHeader>
            <div className="space-y-5 py-6">
              <div className="space-y-2"><Label htmlFor="professional-name">Nome</Label><Input id="professional-name" required value={professionalForm.name} onChange={(event) => setProfessionalForm((current) => ({ ...current, name: event.target.value }))} className="shadow-inset" /></div>
              <div className="space-y-2"><Label htmlFor="professional-specialty">Especialidade</Label><Input id="professional-specialty" value={professionalForm.specialty} onChange={(event) => setProfessionalForm((current) => ({ ...current, specialty: event.target.value }))} className="shadow-inset" /></div>
              {configuration.companies.length > 0 ? <div className="space-y-3"><Label>Empresas</Label>{configuration.companies.map((company) => <label key={company.id} className="flex cursor-pointer items-center gap-2"><Checkbox checked={professionalForm.companyIds.includes(company.id)} onCheckedChange={(checked) => setProfessionalForm((current) => ({ ...current, companyIds: checked ? [...current.companyIds, company.id] : current.companyIds.filter((id) => id !== company.id) }))} /><span>{company.name} · {company.city}/{company.state}</span></label>)}</div> : null}
              {professionalForm.companyIds.length === 0 ? <div className="space-y-2"><Label htmlFor="independent-location">Local de atendimento</Label><Input id="independent-location" value={professionalForm.independentLocationName} onChange={(event) => setProfessionalForm((current) => ({ ...current, independentLocationName: event.target.value }))} className="shadow-inset" /></div> : null}
              {configuration.services.length > 0 ? (
                <div className="space-y-3">
                  <div><Label>Serviços atendidos</Label><p className="mt-1 text-xs text-[var(--color-gray-500)]">Os serviços selecionados serão vinculados aos locais deste profissional.</p></div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {configuration.services.filter((service) => service.is_active).map((service) => (
                      <label key={service.id} className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3">
                        <Checkbox
                          checked={professionalForm.serviceIds.includes(service.id)}
                          onCheckedChange={(checked) => setProfessionalForm((current) => ({
                            ...current,
                            serviceIds: checked
                              ? [...new Set([...current.serviceIds, service.id])]
                              : current.serviceIds.filter((id) => id !== service.id),
                          }))}
                        />
                        <span className="min-w-0"><span className="block truncate text-sm font-medium text-[var(--color-gray-800)]">{service.name}</span><span className="block text-xs text-[var(--color-gray-500)]">{service.duration_minutes} min</span></span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setProfessionalDialogOpen(false)}>Cancelar</Button><Button type="submit" disabled={configuration.saving} className="shadow-primary">{configuration.saving ? <Loader2 className="animate-spin" /> : null}{editingProfessionalId ? "Salvar" : "Adicionar"}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={serviceDialogOpen} onOpenChange={setServiceDialogOpen}>
        <DialogContent className="max-w-xl shadow-modal">
          <form onSubmit={submitService}>
            <DialogHeader><DialogTitle>Adicionar serviço</DialogTitle><DialogDescription>Defina duração e valor padrão.</DialogDescription></DialogHeader>
            <div className="grid gap-5 py-6 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="service-name">Nome</Label><Input id="service-name" required value={serviceForm.name} onChange={(event) => setServiceForm((current) => ({ ...current, name: event.target.value }))} className="shadow-inset" /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="service-description">Descrição</Label><Textarea id="service-description" value={serviceForm.description} onChange={(event) => setServiceForm((current) => ({ ...current, description: event.target.value }))} className="shadow-inset" /></div>
              <div className="space-y-2"><Label htmlFor="service-duration">Duração em minutos</Label><Input id="service-duration" type="number" min={5} value={serviceForm.durationMinutes} onChange={(event) => setServiceForm((current) => ({ ...current, durationMinutes: Number(event.target.value) }))} className="shadow-inset" /></div>
              <div className="space-y-2"><Label htmlFor="service-price">Valor</Label><Input id="service-price" inputMode="decimal" value={serviceForm.price} onChange={(event) => setServiceForm((current) => ({ ...current, price: event.target.value }))} placeholder="0,00" className="shadow-inset" /></div>
              <div className="space-y-2"><Label htmlFor="buffer-before">Intervalo antes</Label><Input id="buffer-before" type="number" min={0} value={serviceForm.bufferBeforeMinutes} onChange={(event) => setServiceForm((current) => ({ ...current, bufferBeforeMinutes: Number(event.target.value) }))} className="shadow-inset" /></div>
              <div className="space-y-2"><Label htmlFor="buffer-after">Intervalo depois</Label><Input id="buffer-after" type="number" min={0} value={serviceForm.bufferAfterMinutes} onChange={(event) => setServiceForm((current) => ({ ...current, bufferAfterMinutes: Number(event.target.value) }))} className="shadow-inset" /></div>
              <p className="text-xs text-[var(--color-gray-500)] sm:col-span-2">Use 0 para permitir atendimentos consecutivos, como 09:00–09:30 e 09:30–10:00.</p>
            </div>
            <DialogFooter><Button type="button" variant="ghost" onClick={() => setServiceDialogOpen(false)}>Cancelar</Button><Button type="submit" disabled={configuration.saving} className="shadow-primary">{configuration.saving ? <Loader2 className="animate-spin" /> : null}Adicionar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={serviceOverrideDialogOpen} onOpenChange={setServiceOverrideDialogOpen}>
        <DialogContent className="max-w-xl shadow-modal">
          <form onSubmit={submitServiceOverrides}>
            <DialogHeader>
              <DialogTitle>Ajustar servico neste local</DialogTitle>
              <DialogDescription>
                {serviceOverrideForm.serviceName} - {serviceOverrideForm.locationLabel}. Deixe vazio para usar o valor padrao do servico.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-5 py-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="override-duration">Duracao em minutos</Label>
                <Input
                  id="override-duration"
                  type="number"
                  min={5}
                  value={serviceOverrideForm.durationMinutes}
                  onChange={(event) => setServiceOverrideForm((current) => ({ ...current, durationMinutes: event.target.value }))}
                  placeholder="Usar padrao"
                  className="shadow-inset"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="override-price">Valor</Label>
                <Input
                  id="override-price"
                  inputMode="decimal"
                  value={serviceOverrideForm.price}
                  onChange={(event) => setServiceOverrideForm((current) => ({ ...current, price: event.target.value }))}
                  placeholder="Usar padrao"
                  className="shadow-inset"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="override-buffer-before">Intervalo antes</Label>
                <Input
                  id="override-buffer-before"
                  type="number"
                  min={0}
                  value={serviceOverrideForm.bufferBeforeMinutes}
                  onChange={(event) => setServiceOverrideForm((current) => ({ ...current, bufferBeforeMinutes: event.target.value }))}
                  placeholder="Usar padrao"
                  className="shadow-inset"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="override-buffer-after">Intervalo depois</Label>
                <Input
                  id="override-buffer-after"
                  type="number"
                  min={0}
                  value={serviceOverrideForm.bufferAfterMinutes}
                  onChange={(event) => setServiceOverrideForm((current) => ({ ...current, bufferAfterMinutes: event.target.value }))}
                  placeholder="Usar padrao"
                  className="shadow-inset"
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setServiceOverrideDialogOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={configuration.saving} className="shadow-primary">
                {configuration.saving ? <Loader2 className="animate-spin" /> : null}
                Salvar ajustes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
