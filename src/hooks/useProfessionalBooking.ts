import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

type CompanyRow = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
};

type ProfessionalRow = {
  id: string;
  name: string;
  specialty: string | null;
};

type LocationRow = {
  id: string;
  professional_id: string;
  empresa_id: string | null;
  location_name: string | null;
};

type ServiceRow = {
  id: string;
  name: string;
  duration_minutes: number;
  price_cents: number | null;
};

type BindingRow = {
  professional_location_id: string;
  service_id: string;
};

export type BookingLocationOption = LocationRow & {
  professional_name: string;
  specialty: string | null;
  empresa_name: string | null;
  display_location: string;
};

export type BookingSlot = {
  slot_start: string;
  slot_end: string;
  professional_id: string;
  professional_name: string;
  empresa_id: string | null;
  empresa_name: string | null;
  service_id: string;
  service_name: string;
  duration_minutes: number;
  price_cents: number | null;
};

export function useProfessionalBooking(enabled: boolean) {
  const { acesId } = useAuth();
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [professionals, setProfessionals] = useState<ProfessionalRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  const [timezone, setTimezone] = useState("America/Sao_Paulo");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!enabled || acesId === null) return;

    setLoading(true);
    try {
      const calendar = supabase.schema("calendar");
      const [companyResult, professionalResult, locationResult, serviceResult, bindingResult, settingsResult] = await Promise.all([
        supabase
          .from("empresas")
          .select("id, name, address, city, state")
          .eq("aces_id", acesId)
          .eq("is_active", true)
          .order("name"),
        calendar.from("professionals").select("id, name, specialty").eq("aces_id", acesId).eq("is_active", true).order("name"),
        calendar.from("professional_locations").select("id, professional_id, empresa_id, location_name").eq("aces_id", acesId).eq("is_active", true),
        calendar.from("services").select("id, name, duration_minutes, price_cents").eq("aces_id", acesId).eq("is_active", true).order("name"),
        calendar.from("professional_services").select("professional_location_id, service_id").eq("aces_id", acesId).eq("is_active", true),
        calendar.from("settings").select("timezone").eq("aces_id", acesId).maybeSingle(),
      ]);

      const error = companyResult.error ?? professionalResult.error ?? locationResult.error ?? serviceResult.error ?? bindingResult.error ?? settingsResult.error;
      if (error) throw error;

      setCompanies((companyResult.data ?? []) as CompanyRow[]);
      setProfessionals((professionalResult.data ?? []) as ProfessionalRow[]);
      setLocations((locationResult.data ?? []) as LocationRow[]);
      setServices((serviceResult.data ?? []) as ServiceRow[]);
      setBindings((bindingResult.data ?? []) as BindingRow[]);
      setTimezone(String(settingsResult.data?.timezone ?? "America/Sao_Paulo"));
    } finally {
      setLoading(false);
    }
  }, [acesId, enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const locationOptions = useMemo<BookingLocationOption[]>(() => {
    const professionalsById = new Map(professionals.map((professional) => [professional.id, professional]));
    const companiesById = new Map(companies.map((company) => [company.id, company]));

    return locations.flatMap((location) => {
      const professional = professionalsById.get(location.professional_id);
      if (!professional) return [];
      const company = location.empresa_id ? companiesById.get(location.empresa_id) ?? null : null;
      const displayLocation = company
        ? [company.address, company.city, company.state].filter(Boolean).join(" â€” ")
        : location.location_name || "Atendimento independente";

      return [{
        ...location,
        professional_name: professional.name,
        specialty: professional.specialty,
        empresa_name: company?.name ?? null,
        display_location: displayLocation,
      }];
    });
  }, [companies, locations, professionals]);

  const servicesForLocation = useCallback((locationId: string) => {
    const serviceIds = new Set(
      bindings
        .filter((binding) => binding.professional_location_id === locationId)
        .map((binding) => binding.service_id),
    );
    return services.filter((service) => serviceIds.has(service.id));
  }, [bindings, services]);

  const listSlots = useCallback(async (
    professionalLocationId: string,
    serviceId: string,
    date: string,
    excludeEventId?: string | null,
  ) => {
    const { data, error } = await supabase.schema("calendar").rpc("list_available_slots", {
      p_professional_location_id: professionalLocationId,
      p_service_id: serviceId,
      p_date_from: date,
      p_date_until: date,
      p_period: null,
      p_limit: 50,
      p_exclude_event_id: excludeEventId || null,
    });
    if (error) throw error;
    return (data ?? []) as BookingSlot[];
  }, []);

  return {
    loading,
    locationOptions,
    servicesForLocation,
    listSlots,
    timezone,
  };
}
