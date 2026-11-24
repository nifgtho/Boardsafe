export type UserRole =
  | "passenger"
  | "driver"
  | "dispatcher"
  | "inspector"
  | "authority"
  | "admin";

export type BayStatus = "clear" | "blocked" | "unknown";

export type SupportOption = "ramp" | "audio" | "text" | "boarding_help";

export type AssistanceStatus =
  | "requested"
  | "offered"
  | "accepted"
  | "onboard"
  | "completed"
  | "waiting_safe"
  | "interrupted"
  | "cancelled"
  | "expired"
  | "unable_to_serve";

export type RouteStatus = "candidate" | "verified" | "revoked" | "blocked";

export type ReportKind =
  | "debris"
  | "landslide"
  | "flood"
  | "rain"
  | "blocked_bay"
  | "accessibility"
  | "road_damage"
  | "other";

export type ReportStatus = "pending" | "verified" | "rejected";

export type RestrictionStatus = "closed" | "restricted" | "open";

export type AssetType = "excavator" | "truck" | "brigade" | "other";

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  active?: boolean;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface LineStringGeoJSON {
  type: "LineString";
  coordinates: [number, number][]; // [lon, lat]
}

export interface StopRecord {
  id: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
  wheelchair_accessible: boolean;
  bay_status: BayStatus;
  bay_effective_status: BayStatus;
  bay_checked_at: string | null;
  bay_source: string | null;
}

export interface VehicleRecord {
  id: string;
  code: string;
  operator_name: string;
  driver_id: string | null;
  accessible_spaces_total: number;
  accessible_spaces_free: number | null;
  ramp_ok: boolean | null;
  at_lat: number | null;
  at_lon: number | null;
  state_checked_at: string | null;
  state_fresh: boolean;
}

export interface AssistanceRecord {
  id: string;
  passenger_id: string | null;
  stop_id: string;
  destination_lat: number;
  destination_lon: number;
  support: SupportOption[];
  consent_operational: boolean;
  vehicle_id: string | null;
  route_id: string | null;
  state: AssistanceStatus;
  expires_at: string;
  created_at?: string;
  updated_at?: string;
}

export interface RoutePlanRecord {
  id: string;
  requested_by: string;
  geometry: LineStringGeoJSON;
  origin: [number, number];
  destination: [number, number];
  distance_m: number;
  duration_s: number;
  status: RouteStatus;
  evaluated_at: string;
  verified_by: string | null;
  verified_at: string | null;
  expires_at: string | null;
  verification_note: string | null;
}

export interface ReportRecord {
  id: string;
  author_id: string;
  kind: ReportKind;
  description: string;
  lat: number;
  lon: number;
  status: ReportStatus;
  verified_by: string | null;
  reviewed_at: string | null;
  created_at?: string;
}

export interface RoadRestrictionRecord {
  id: string;
  name: string;
  geometry: LineStringGeoJSON;
  status: RestrictionStatus;
  source_report_id: string | null;
  confirmed_by: string;
  confirmation_note: string;
  confirmed_at: string;
  expires_at: string | null;
}

export interface RiskZoneRecord {
  id: string;
  name: string;
  lat: number;
  lon: number;
  radius_m: number;
  susceptibility: number;
  critical_access: boolean;
  source: string;
  source_version: string;
}

export interface ResponseAssetRecord {
  id: string;
  code: string;
  asset_type: AssetType;
  lat: number;
  lon: number;
  state: string;
}

export interface DomainEventRecord {
  id: number;
  event_type: string;
  resource_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}