import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Search, Loader2, MapPinned, Phone, Mail, Globe, Star } from "lucide-react";
import { MapContainer, TileLayer, Marker, Circle, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useInstances } from "@/hooks/useInstances";
import { BuscarLeadResult, useBuscarLeads } from "@/hooks/useBuscarLeads";

delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const fieldsOptions = [
  { value: "phone", label: "Telefone" },
  { value: "website", label: "Website" },
  { value: "email", label: "Email" },
  { value: "hours", label: "Horários" },
  { value: "reviews", label: "Reviews" },
  { value: "photos", label: "Fotos" },
  { value: "prices", label: "Preços" },
];

const countryOptions = [
  { value: "BR", label: "Brasil" },
  { value: "PT", label: "Portugal" },
  { value: "US", label: "Estados Unidos" },
];

const languageOptions = [
  { value: "pt", label: "Português" },
  { value: "en", label: "English" },
  { value: "es", label: "Español" },
];

const formSchema = z.object({
  searchTerms: z.string().min(1, "Informe ao menos um termo de busca"),
  locationQuery: z.string().min(1, "Informe cidade ou região"),
  country: z.string().min(2, "Informe o país"),
  radiusKm: z.number().min(1).max(50),
  minimumStars: z.number().min(1).max(5),
  maxResults: z.number().min(10).max(500),
  language: z.string().min(2),
  fields: z.array(z.string()).min(1, "Selecione pelo menos um campo"),
  instancia: z.string().min(1, "Selecione uma instância"),
});

type FormValues = z.infer<typeof formSchema>;

function ResultCard({ result }: { result: BuscarLeadResult }) {
  return (
    <Card className="border-border shadow-none">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{result.name}</p>
            <p className="text-xs text-muted-foreground truncate">
              {result.address || [result.city, result.region].filter(Boolean).join(", ") || "Sem endereço"}
            </p>
          </div>
          <Badge variant={result.isImported ? "default" : "secondary"}>
            {result.isImported ? "Importado" : "Novo"}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {typeof result.rating === "number" && (
            <span className="inline-flex items-center gap-1">
              <Star className="w-3.5 h-3.5 text-amber-500" />
              {result.rating.toFixed(1)}
            </span>
          )}
          {result.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="w-3.5 h-3.5" />
              {result.phone}
            </span>
          )}
          {result.email && (
            <span className="inline-flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" />
              {result.email}
            </span>
          )}
          {result.website && (
            <span className="inline-flex items-center gap-1 truncate">
              <Globe className="w-3.5 h-3.5" />
              {result.website}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Buscar() {
  const { instances, loading: loadingInstances } = useInstances();
  const { monthlyTotal, loadingCounter, submitting, status, progress, message, results, center, totals, startSearch } = useBuscarLeads();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      searchTerms: "",
      locationQuery: "",
      country: "BR",
      radiusKm: 10,
      minimumStars: 4,
      maxResults: 50,
      language: "pt",
      fields: ["phone", "website", "email"],
      instancia: "",
    },
  });

  const mapCenter = useMemo<[number, number]>(() => {
    if (center) return [center.lat, center.lng];
    const firstWithCoords = results.find((item) => typeof item.lat === "number" && typeof item.lng === "number");
    if (firstWithCoords?.lat && firstWithCoords?.lng) {
      return [firstWithCoords.lat, firstWithCoords.lng];
    }
    return [-23.5505, -46.6333];
  }, [center, results]);

  const onSubmit = (values: FormValues) => {
    const payload = {
      searchStrings: values.searchTerms.split(",").map((item) => item.trim()).filter(Boolean),
      locationQuery: values.locationQuery,
      country: values.country,
      radiusKm: values.radiusKm,
      minimumStars: values.minimumStars,
      maxResults: values.maxResults,
      language: values.language,
      fields: values.fields,
      instancia: values.instancia,
    };

    void startSearch(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Buscar</h1>
          <p className="text-muted-foreground mt-1">Prospecção de leads via Google Maps com importação direta para o CRM.</p>
        </div>

        <Card className="min-w-[280px] border-border shadow-none">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Buscas este mês</p>
              {loadingCounter ? (
                <Skeleton className="h-8 w-28 mt-2" />
              ) : (
                <p className="text-2xl font-semibold">{monthlyTotal} leads</p>
              )}
            </div>
            <MapPinned className="w-8 h-8 text-primary" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card className="border-border shadow-none">
          <CardHeader>
            <CardTitle>Nova busca</CardTitle>
            <CardDescription>Defina os filtros, a região e a instância que receberá os leads importados.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                <FormField
                  control={form.control}
                  name="searchTerms"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Termos de busca</FormLabel>
                      <FormControl>
                        <Input placeholder="ótica, clínica oftalmológica, exame de vista" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="locationQuery"
                    render={({ field }) => (
                      <FormItem className="sm:col-span-2">
                        <FormLabel>Cidade / Região</FormLabel>
                        <FormControl>
                          <Input placeholder="São Paulo, SP" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>País</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {countryOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="language"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Idioma</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {languageOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="instancia"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Instância</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value} disabled={loadingInstances}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={loadingInstances ? "Carregando instâncias..." : "Selecione"} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {instances.map((instance) => (
                            <SelectItem key={instance.instancia} value={instance.instancia}>
                              {instance.instancia}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="radiusKm"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Raio de busca</FormLabel>
                        <span className="text-sm text-muted-foreground">{field.value} km</span>
                      </div>
                      <FormControl>
                        <Slider
                          min={1}
                          max={50}
                          step={1}
                          value={[field.value]}
                          onValueChange={([value]) => field.onChange(value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="minimumStars"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Avaliação mínima</FormLabel>
                        <span className="text-sm text-muted-foreground">{field.value.toFixed(1)} estrelas</span>
                      </div>
                      <FormControl>
                        <Slider
                          min={1}
                          max={5}
                          step={0.5}
                          value={[field.value]}
                          onValueChange={([value]) => field.onChange(value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="maxResults"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>Máximo de resultados</FormLabel>
                        <span className="text-sm text-muted-foreground">{field.value}</span>
                      </div>
                      <FormControl>
                        <Slider
                          min={10}
                          max={500}
                          step={10}
                          value={[field.value]}
                          onValueChange={([value]) => field.onChange(value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="fields"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dados a coletar</FormLabel>
                      <FormControl>
                        <ToggleGroup
                          type="multiple"
                          className="flex flex-wrap justify-start gap-2"
                          value={field.value}
                          onValueChange={(value) => field.onChange(value)}
                        >
                          {fieldsOptions.map((option) => (
                            <ToggleGroupItem
                              key={option.value}
                              value={option.value}
                              className="rounded-full border border-[#cfe2f5] data-[state=on]:bg-[#E6F1FB] data-[state=on]:text-[#185FA5]"
                            >
                              {option.label}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                  Iniciar busca
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-border shadow-none overflow-hidden">
            <CardHeader>
              <CardTitle>Mapa e progresso</CardTitle>
              <CardDescription>{center?.label ?? "A busca será centralizada na região informada."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {status === "idle" ? "Aguardando nova busca" : message || "Processando busca"}
                  </span>
                  <span className="font-medium">{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>

              {totals && (
                <div className="grid gap-3 sm:grid-cols-4">
                  <Card className="shadow-none border-border">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">Encontrados</p>
                      <p className="text-xl font-semibold">{totals.fetched}</p>
                    </CardContent>
                  </Card>
                  <Card className="shadow-none border-border">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">Com telefone</p>
                      <p className="text-xl font-semibold">{totals.withPhone}</p>
                    </CardContent>
                  </Card>
                  <Card className="shadow-none border-border">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">Importados</p>
                      <p className="text-xl font-semibold">{totals.inserted}</p>
                    </CardContent>
                  </Card>
                  <Card className="shadow-none border-border">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">Duplicados</p>
                      <p className="text-xl font-semibold">{totals.duplicates}</p>
                    </CardContent>
                  </Card>
                </div>
              )}

              <div className="h-[420px] rounded-xl overflow-hidden border border-border">
                <MapContainer center={mapCenter} zoom={11} scrollWheelZoom className="h-full w-full">
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  {center && <Circle center={[center.lat, center.lng]} radius={form.watch("radiusKm") * 1000} pathOptions={{ color: "#03E3B6", fillOpacity: 0.12 }} />}

                  {results
                    .filter((item) => typeof item.lat === "number" && typeof item.lng === "number")
                    .map((item, index) => (
                      <Marker key={`${item.externalId ?? item.phone ?? item.name}-${index}`} position={[item.lat as number, item.lng as number]}>
                        <Popup>
                          <div className="space-y-1">
                            <p className="font-medium">{item.name}</p>
                            {item.phone && <p>{item.phone}</p>}
                            {item.address && <p>{item.address}</p>}
                          </div>
                        </Popup>
                      </Marker>
                    ))}
                </MapContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border shadow-none">
            <CardHeader>
              <CardTitle>Resultados</CardTitle>
              <CardDescription>{results.length ? `${results.length} local(is) retornado(s) pela busca.` : "Os locais encontrados aparecerão aqui."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[520px] overflow-auto">
              {results.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Nenhum resultado ainda. Preencha os filtros e inicie a busca.
                </div>
              ) : (
                results.map((result, index) => (
                  <ResultCard key={`${result.externalId ?? result.phone ?? result.name}-${index}`} result={result} />
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
