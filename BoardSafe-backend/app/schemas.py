import re
from datetime import datetime
from typing import Literal, Annotated
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator

class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

Lat = Annotated[float, Field(ge=-90, le=90)]
Lon = Annotated[float, Field(ge=-180, le=180)]

class Account(Strict):
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=12, max_length=256)
    @field_validator("email")
    @classmethod
    def email_format(cls, v):
        v = v.lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", v):
            raise ValueError("Correo inválido")
        return v

class CreateStaff(Account):
    role: Literal["driver", "dispatcher", "inspector", "authority", "admin"]

class StaffOut(Strict):
    id: str
    email: str
    role: Literal["driver", "dispatcher", "inspector", "authority", "admin"]
    active: bool

class Login(Strict):
    email: str
    password: str

class StopIn(Strict):
    code: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=2, max_length=200)
    lat: Lat
    lon: Lon
    wheelchair_accessible: bool = False

class StopBay(Strict):
    status: Literal["clear", "blocked", "unknown"]
    note: str = Field(min_length=8, max_length=500)

class VehicleIn(Strict):
    code: str = Field(min_length=2, max_length=80)
    operator_name: str = Field(min_length=2, max_length=160)
    driver_id: str | None = None
    accessible_spaces_total: int = Field(ge=0, le=100)

class VehicleCheck(Strict):
    accessible_spaces_free: int = Field(ge=0, le=100)
    ramp_ok: bool
    at_lat: Lat | None = None
    at_lon: Lon | None = None
    @model_validator(mode="after")
    def consistent_location(self):
        if (self.at_lat is None) != (self.at_lon is None):
            raise ValueError("Enviar ambas coordenadas o ninguna")
        return self

class AssistanceIn(Strict):
    stop_id: str
    destination_lat: Lat
    destination_lon: Lon
    support: list[Literal["ramp", "audio", "text", "boarding_help"]] = Field(min_length=1, max_length=4)
    consent_operational: bool
    @model_validator(mode="after")
    def consent_check(self):
        if not self.consent_operational:
            raise ValueError("Se requiere consentimiento para tramitar esta solicitud")
        if len(set(self.support)) != len(self.support):
            raise ValueError("No se permiten apoyos repetidos")
        return self

class AssistanceOffer(Strict):
    vehicle_id: str
    route_id: str

class ReportIn(Strict):
    kind: Literal["debris", "landslide", "flood", "rain", "blocked_bay", "accessibility", "road_damage", "other"]
    description: str = Field(min_length=10, max_length=1500)
    lat: Lat
    lon: Lon

class ReportReview(Strict):
    status: Literal["verified", "rejected"]
    reason: str = Field(min_length=10, max_length=800)

class LineString(Strict):
    type: Literal["LineString"] = "LineString"
    coordinates: list[tuple[Lon, Lat]] = Field(min_length=2, max_length=5000)

class RestrictionIn(Strict):
    name: str = Field(min_length=3, max_length=200)
    geometry: LineString
    status: Literal["closed", "restricted"] = "closed"
    source_report_id: str | None = None
    confirmation_note: str = Field(min_length=12, max_length=1000)
    expires_at: datetime | None = None

class RestrictionChange(Strict):
    status: Literal["open", "closed", "restricted"]
    confirmation_note: str = Field(min_length=12, max_length=1000)

class RoutingRequest(Strict):
    origin_lat: Lat
    origin_lon: Lon
    destination_lat: Lat
    destination_lon: Lon

class RouteVerification(Strict):
    note: str = Field(min_length=12, max_length=1200)
    valid_minutes: int = Field(ge=1, le=1440, default=60)
    @field_validator("note")
    @classmethod
    def evidence(cls, v):
        if "verificado" not in v.lower() and "inspec" not in v.lower():
            # descriptive note is enough, but encourage explicit evidence
            return v
        return v

class EdgeNodeIn(Strict):
    kind: Literal["camera", "totem"] = "camera"
    code: str = Field(min_length=3, max_length=100)
    stop_id: str | None = None
    vehicle_id: str | None = None
    @model_validator(mode="after")
    def one_target(self):
        if bool(self.stop_id) == bool(self.vehicle_id):
            raise ValueError("El nodo pertenece a un paradero o vehículo, no ambos")
        return self

class EdgeNodeOut(Strict):
    id: str
    code: str
    kind: Literal["camera", "totem"]
    stop_id: str | None
    vehicle_id: str | None
    enabled: bool
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime

class EdgeSignal(Strict):
    event_type: Literal["bay_obstruction", "bay_no_obstruction", "space_occupied", "space_no_obstruction", "node_fault"]
    confidence: float = Field(ge=0, le=1)
    observed_at: datetime

class RainIn(Strict):
    kind: Literal["observation", "forecast"]
    source: str = Field(min_length=3, max_length=150)
    source_ref: str = Field(min_length=3, max_length=300)
    lat: Lat
    lon: Lon
    mm: float = Field(ge=0, le=3000)
    period_hours: int = Field(ge=1, le=168)
    observed_at: datetime

class RiskZoneIn(Strict):
    name: str = Field(min_length=3, max_length=150)
    lat: Lat
    lon: Lon
    radius_m: int = Field(ge=20, le=200000)
    susceptibility: int = Field(ge=0, le=5)
    critical_access: bool = False
    source: str = Field(min_length=3, max_length=180)
    source_version: str = Field(min_length=1, max_length=120)

class ResponseAssetIn(Strict):
    code: str = Field(min_length=3, max_length=70)
    asset_type: Literal["excavator", "truck", "brigade", "other"]
    lat: Lat
    lon: Lon

class ResourceAction(Strict):
    zone_id: str
    action: Literal["prepare", "deploy", "stand_down"]
    reason: str = Field(min_length=12, max_length=1200)


class KioskAssistance(Strict):
    destination_lat: Lat
    destination_lon: Lon
    support: list[Literal["ramp", "audio", "text", "boarding_help"]] = Field(min_length=1, max_length=4)
    consent_operational: bool
    @model_validator(mode="after")
    def validate_consent(self):
        if not self.consent_operational:raise ValueError("Se necesita el consentimiento para crear la solicitud")
        if len(set(self.support))!=len(self.support):raise ValueError("Apoyos duplicados")
        return self


class TrackingToken(Strict):
    token: str = Field(min_length=30, max_length=256)
