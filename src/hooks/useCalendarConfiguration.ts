import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

export type CalendarSettings = {
  aces_id: number;
  timezone: string;
  minimum_notice_minutes: number;
  booking_horizon_days: number;
  slot_interval_minutes: number;
  ai_booking_enabled: boolean;
};

export type CalendarCompany = {
  id: string;
  name: string;
  city: string;
  state: string;
  is_active: boolean;
};

export type CalendarProfessional = {
  id: string;
  aces_id: number;
  name: string;
  specialty: string | null;
  is_active: boolean;
};

export type ProfessionalLocation = {
  id: string;
  aces_id: number;
  professional_id: string;
  empresa_id: string | null;
  location_name: string | null;
  is_active: boolean;
  is_ai_visible: boolean;
};

export type CalendarService = {
  id: string;
  aces_id: number;
  name: string;
  description: string | null;
  duration_minutes: number;
  price_cents: number | null;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  is_active: boolean;
  is_ai_visible: boolean;
};

export type ProfessionalService = {
  id: string;
  professional_location_id: string;
  service_id: string;
  duration_minutes_override: number | null;
  price_cents_override: number | null;
  buffer_before_minutes_override: number | null;
  buffer_after_minutes_override: number | null;
  is_active: boolean;
  is_ai_visible: boolean;
};

export type AvailabilityRule = {
  id: string;
  professional_location_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
};

export type AvailabilityException = {
  id: string;
  empresa_id: string | null;
  professional_location_id: string | null;
  exception_type: "block" | "pause" | "holiday" | "vacation";
  starts_at: string;
  ends_at: string;
  reason: string | null;
  is_active: boolean;
};

type ProfessionalInput = {
  name: string;
  specialty?: string;
  companyIds: string[];
  independentLocationName?: string;
  serviceIds: string[];
};

type ServiceInput = {
  name: string;
  description?: string;
  durationMinutes: number;
  priceCents: number | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
};

export function useCalendarConfiguration(acesId: number | null, enabled = true) {
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [companies, setCompanies] = useState<CalendarCompany[]>([]);
  const [professionals, setProfessionals] = useState<CalendarProfessional[]>([]);
  const [locations, setLocations] = useState<ProfessionalLocation[]>([]);
  const [services, setServices] = useState<CalendarService[]>([]);
  const [professionalServices, setProfessionalServices] = useState<ProfessionalService[]>([]);
  const [availabilityRules, setAvailabilityRules] = useState<AvailabilityRule[]>([]);
  const [exceptions, setExceptions] = useState<AvailabilityException[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || acesId === null) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const calendar = supabase.schema("calendar");
      const [
        settingsResult,
        companiesResult,
        professionalsResult,
        locationsResult,
        servicesResult,
        professionalServicesResult,
        rulesResult,
        exceptionsResult,
      ] = await Promise.all([
        calendar.from("settings").select("*").eq("aces_id", acesId).maybeSingle(),
        supabase
          .from("empresas")
          .select("id, name, city, state, is_active")
          .eq("aces_id", acesId)
          .eq("is_active", true)
          .order("name"),
        calendar.from("professionals").select("*").eq("aces_id", acesId).order("name"),
        calendar.from("professional_locations").select("*").eq("aces_id", acesId),
        calendar.from("services").select("*").eq("aces_id", acesId).order("name"),
        calendar.from("professional_services").select("*").eq("aces_id", acesId),
        calendar
          .from("availability_rules")
          .select("*")
          .eq("aces_id", acesId)
          .eq("is_active", true)
          .order("weekday")
          .order("start_time"),
        calendar
          .from("availability_exceptions")
          .select("*")
          .eq("aces_id", acesId)
          .eq("is_active", true)
          .order("starts_at"),
      ]);

      const error =
        settingsResult.error ??
        companiesResult.error ??
        professionalsResult.error ??
        locationsResult.error ??
        servicesResult.error ??
        professionalServicesResult.error ??
        rulesResult.error ??
        exceptionsResult.error;
      if (error) throw error;

      setSettings((settingsResult.data as CalendarSettings | null) ?? null);
      setCompanies((companiesResult.data as CalendarCompany[]) ?? []);
      setProfessionals((professionalsResult.data as CalendarProfessional[]) ?? []);
      setLocations((locationsResult.data as ProfessionalLocation[]) ?? []);
      setServices((servicesResult.data as CalendarService[]) ?? []);
      setProfessionalServices((professionalServicesResult.data as ProfessionalService[]) ?? []);
      setAvailabilityRules((rulesResult.data as AvailabilityRule[]) ?? []);
      setExceptions((exceptionsResult.data as AvailabilityException[]) ?? []);
    } catch (error) {
      toast.error("Erro ao carregar a configuração da agenda", {
        description: error instanceof Error ? error.message : "Tente novamente.",
      });
    } finally {
      setLoading(false);
    }
  }, [acesId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const runMutation = useCallback(
    async (mutation: () => Promise<void>, successMessage: string) => {
      try {
        setSaving(true);
        await mutation();
        toast.success(successMessage);
        await load();
        return true;
      } catch (error) {
        toast.error("Não foi possível salvar", {
          description: error instanceof Error ? error.message : "Tente novamente.",
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [load],
  );

  const saveSettings = useCallback(
    (input: Omit<CalendarSettings, "aces_id">) =>
      runMutation(async () => {
        if (acesId === null) throw new Error("Conta não identificada.");
        const { error } = await supabase.schema("calendar").from("settings").upsert({
          aces_id: acesId,
          ...input,
        });
        if (error) throw error;
      }, "Configuração geral atualizada"),
    [acesId, runMutation],
  );

  const createProfessional = useCallback(
    (input: ProfessionalInput) =>
      runMutation(async () => {
        if (acesId === null) throw new Error("Conta não identificada.");
        const calendar = supabase.schema("calendar");
        const { data: professional, error: professionalError } = await calendar
          .from("professionals")
          .insert({
            aces_id: acesId,
            name: input.name.trim(),
            specialty: input.specialty?.trim() || null,
          })
          .select("id")
          .single();
        if (professionalError) throw professionalError;

        const locationRows = input.companyIds.length > 0
          ? input.companyIds.map((companyId) => ({
              aces_id: acesId,
              professional_id: professional.id,
              empresa_id: companyId,
            }))
          : [{
              aces_id: acesId,
              professional_id: professional.id,
              empresa_id: null,
              location_name: input.independentLocationName?.trim() || "Atendimento independente",
            }];
        const { data: createdLocations, error: locationError } = await calendar
          .from("professional_locations")
          .insert(locationRows)
          .select("id");
        if (locationError) {
          await calendar.from("professionals").delete().eq("id", professional.id);
          throw locationError;
        }

        if (input.serviceIds.length > 0) {
          const serviceRows = (createdLocations ?? []).flatMap((location) =>
            input.serviceIds.map((serviceId) => ({
              aces_id: acesId,
              professional_location_id: location.id,
              service_id: serviceId,
              is_active: true,
            })),
          );
          const { error: serviceError } = await calendar.from("professional_services").insert(serviceRows);
          if (serviceError) {
            await calendar.from("professionals").delete().eq("id", professional.id);
            throw serviceError;
          }
        }
      }, "Profissional adicionado"),
    [acesId, runMutation],
  );

  const setProfessionalActive = useCallback(
    (professionalId: string, isActive: boolean) =>
      runMutation(async () => {
        const { error } = await supabase
          .schema("calendar")
          .from("professionals")
          .update({ is_active: isActive })
          .eq("id", professionalId);
        if (error) throw error;
      }, isActive ? "Profissional ativado" : "Profissional pausado"),
    [runMutation],
  );

  const updateProfessional = useCallback(
    (professionalId: string, input: ProfessionalInput) =>
      runMutation(async () => {
        if (acesId === null) throw new Error("Conta nao identificada.");
        const calendar = supabase.schema("calendar");
        const { error: professionalError } = await calendar
          .from("professionals")
          .update({
            name: input.name.trim(),
            specialty: input.specialty?.trim() || null,
          })
          .eq("id", professionalId)
          .eq("aces_id", acesId);
        if (professionalError) throw professionalError;

        const currentLocations = locations.filter((location) => location.professional_id === professionalId);
        const desiredCompanyIds = new Set(input.companyIds);
        const activeLocationIds: string[] = [];

        for (const current of currentLocations) {
          const shouldRemainActive = current.empresa_id
            ? desiredCompanyIds.has(current.empresa_id)
            : desiredCompanyIds.size === 0;
          const { error } = await calendar
            .from("professional_locations")
            .update({
              is_active: shouldRemainActive,
              location_name: current.empresa_id
                ? current.location_name
                : input.independentLocationName?.trim() || "Atendimento independente",
            })
            .eq("id", current.id);
          if (error) throw error;
          if (shouldRemainActive) activeLocationIds.push(current.id);
        }

        for (const companyId of desiredCompanyIds) {
          const existing = currentLocations.find((location) => location.empresa_id === companyId);
          if (existing) continue;
          const { data: inserted, error } = await calendar.from("professional_locations").insert({
            aces_id: acesId,
            professional_id: professionalId,
            empresa_id: companyId,
          }).select("id").single();
          if (error) throw error;
          activeLocationIds.push(inserted.id);
        }

        if (desiredCompanyIds.size === 0 && !currentLocations.some((location) => location.empresa_id === null)) {
          const { data: inserted, error } = await calendar.from("professional_locations").insert({
            aces_id: acesId,
            professional_id: professionalId,
            empresa_id: null,
            location_name: input.independentLocationName?.trim() || "Atendimento independente",
          }).select("id").single();
          if (error) throw error;
          activeLocationIds.push(inserted.id);
        }

        if (activeLocationIds.length > 0) {
          const selectedServiceIds = [...new Set(input.serviceIds)];
          const { data: existingBindings, error: bindingsError } = await calendar
            .from("professional_services")
            .select("id, professional_location_id, service_id")
            .in("professional_location_id", activeLocationIds);
          if (bindingsError) throw bindingsError;

          if (selectedServiceIds.length > 0) {
            const rows = activeLocationIds.flatMap((locationId) =>
              selectedServiceIds.map((serviceId) => ({
                aces_id: acesId,
                professional_location_id: locationId,
                service_id: serviceId,
                is_active: true,
              })),
            );
            const { error: upsertError } = await calendar.from("professional_services").upsert(rows, {
              onConflict: "professional_location_id,service_id",
            });
            if (upsertError) throw upsertError;
          }

          const obsoleteBindingIds = (existingBindings ?? [])
            .filter((binding) => !selectedServiceIds.includes(binding.service_id))
            .map((binding) => binding.id);
          if (obsoleteBindingIds.length > 0) {
            const { error: deactivateError } = await calendar
              .from("professional_services")
              .update({ is_active: false })
              .in("id", obsoleteBindingIds);
            if (deactivateError) throw deactivateError;
          }
        }
      }, "Profissional atualizado"),
    [acesId, locations, runMutation],
  );

  const createService = useCallback(
    (input: ServiceInput) =>
      runMutation(async () => {
        if (acesId === null) throw new Error("Conta não identificada.");
        const { error } = await supabase.schema("calendar").from("services").insert({
          aces_id: acesId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          duration_minutes: input.durationMinutes,
          price_cents: input.priceCents,
          buffer_before_minutes: input.bufferBeforeMinutes,
          buffer_after_minutes: input.bufferAfterMinutes,
        });
        if (error) throw error;
      }, "Serviço adicionado"),
    [acesId, runMutation],
  );

  const toggleProfessionalService = useCallback(
    (professionalLocationId: string, serviceId: string, enabledForLocation: boolean) =>
      runMutation(async () => {
        if (acesId === null) throw new Error("Conta não identificada.");
        const { error } = await supabase.schema("calendar").from("professional_services").upsert(
          {
            aces_id: acesId,
            professional_location_id: professionalLocationId,
            service_id: serviceId,
            is_active: enabledForLocation,
          },
          { onConflict: "professional_location_id,service_id" },
        );
        if (error) throw error;
      }, enabledForLocation ? "Serviço vinculado" : "Serviço removido do local"),
    [acesId, runMutation],
  );

  const saveProfessionalServiceOverrides = useCallback(
    (
      bindingId: string,
      input: {
        durationMinutes: number | null;
        priceCents: number | null;
        bufferBeforeMinutes: number | null;
        bufferAfterMinutes: number | null;
      },
    ) => runMutation(async () => {
      const { error } = await supabase
        .schema("calendar")
        .from("professional_services")
        .update({
          duration_minutes_override: input.durationMinutes,
          price_cents_override: input.priceCents,
          buffer_before_minutes_override: input.bufferBeforeMinutes,
          buffer_after_minutes_override: input.bufferAfterMinutes,
        })
        .eq("id", bindingId);
      if (error) throw error;
    }, "Ajustes do profissional salvos"),
    [runMutation],
  );

  const createAvailabilityRules = useCallback(
    (input: { professionalLocationId: string; weekdays: number[]; startTime: string; endTime: string }) =>
      runMutation(async () => {
        if (acesId === null) throw new Error("Conta não identificada.");
        if (input.weekdays.length === 0) throw new Error("Selecione ao menos um dia.");
        const rows = [...new Set(input.weekdays)].map((weekday) => ({
          aces_id: acesId,
          professional_location_id: input.professionalLocationId,
          weekday,
          start_time: input.startTime,
          end_time: input.endTime,
        }));
        const { error } = await supabase.schema("calendar").from("availability_rules").insert(rows);
        if (error) throw error;
      }, input.weekdays.length > 1 ? "Horários adicionados" : "Horário adicionado"),
    [acesId, runMutation],
  );

  const removeAvailabilityRule = useCallback(
    (ruleId: string) =>
      runMutation(async () => {
        const { error } = await supabase
          .schema("calendar")
          .from("availability_rules")
          .update({ is_active: false })
          .eq("id", ruleId);
        if (error) throw error;
      }, "Horário removido"),
    [runMutation],
  );

  const createException = useCallback(
    (input: {
      empresaId?: string | null;
      professionalLocationId?: string | null;
      exceptionType: AvailabilityException["exception_type"];
      startsAt: string;
      endsAt: string;
      reason?: string;
    }) =>
      runMutation(async () => {
        if (acesId === null) throw new Error("Conta não identificada.");
        const { error } = await supabase.schema("calendar").from("availability_exceptions").insert({
          aces_id: acesId,
          empresa_id: input.empresaId || null,
          professional_location_id: input.professionalLocationId || null,
          exception_type: input.exceptionType,
          starts_at: input.startsAt,
          ends_at: input.endsAt,
          reason: input.reason?.trim() || null,
        });
        if (error) throw error;
      }, "Bloqueio adicionado"),
    [acesId, runMutation],
  );

  const removeException = useCallback(
    (exceptionId: string) =>
      runMutation(async () => {
        const { error } = await supabase
          .schema("calendar")
          .from("availability_exceptions")
          .update({ is_active: false })
          .eq("id", exceptionId);
        if (error) throw error;
      }, "Bloqueio removido"),
    [runMutation],
  );

  return {
    settings,
    companies,
    professionals,
    locations,
    services,
    professionalServices,
    availabilityRules,
    exceptions,
    loading,
    saving,
    reload: load,
    saveSettings,
    createProfessional,
    setProfessionalActive,
    updateProfessional,
    createService,
    toggleProfessionalService,
    saveProfessionalServiceOverrides,
    createAvailabilityRules,
    removeAvailabilityRule,
    createException,
    removeException,
  };
}
