"""Persistent domain entities. All coordinates are WGS84, lon/lat in GeoJSON arrays."""
import uuid
from sqlalchemy import String, Integer, Float, Boolean, DateTime, ForeignKey, JSON, Text, Index, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db import Base, now_utc

def uid():
    return str(uuid.uuid4())

class Stamp:
    created_at: Mapped[object] = mapped_column(DateTime, default=now_utc, nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime, default=now_utc, onupdate=now_utc, nullable=False)

class User(Base, Stamp):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(32), default="passenger", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    __table_args__ = (Index("ix_users_role", "role"),)

class Stop(Base, Stamp):
    __tablename__ = "stops"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    wheelchair_accessible: Mapped[bool] = mapped_column(Boolean, default=False)
    bay_status: Mapped[str] = mapped_column(String(20), default="unknown")
    bay_checked_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    bay_source: Mapped[str] = mapped_column(String(32), default="none")
    __table_args__ = (CheckConstraint("lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180", name="stop_valid_coordinates"),)

class Vehicle(Base, Stamp):
    __tablename__ = "vehicles"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    operator_name: Mapped[str] = mapped_column(String(160), nullable=False)
    driver_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    accessible_spaces_total: Mapped[int] = mapped_column(Integer, default=0)
    accessible_spaces_free: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ramp_ok: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    at_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    at_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    state_checked_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (CheckConstraint("accessible_spaces_total >= 0", name="vehicle_spaces_total_positive"), CheckConstraint("accessible_spaces_free IS NULL OR accessible_spaces_free >= 0", name="vehicle_spaces_free_positive"),)

class Assistance(Base, Stamp):
    __tablename__ = "assistances"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    passenger_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    stop_id: Mapped[str] = mapped_column(String(36), ForeignKey("stops.id"), nullable=False)
    destination_lat: Mapped[float] = mapped_column(Float, nullable=False)
    destination_lon: Mapped[float] = mapped_column(Float, nullable=False)
    support: Mapped[list] = mapped_column(JSON, default=list)
    consent_operational: Mapped[bool] = mapped_column(Boolean, nullable=False)
    vehicle_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vehicles.id"), nullable=True)
    route_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("route_plans.id"), nullable=True)
    state: Mapped[str] = mapped_column(String(32), default="requested", nullable=False)
    expires_at: Mapped[object] = mapped_column(DateTime, nullable=False)
    __table_args__ = (Index("ix_assistances_owner", "passenger_id", "state"),)

class Report(Base, Stamp):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    author_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    verified_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (Index("ix_reports_status", "status"),)

class RoadRestriction(Base, Stamp):
    __tablename__ = "road_restrictions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    geometry: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="closed", nullable=False)
    source_report_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("reports.id"), nullable=True)
    confirmed_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    confirmation_note: Mapped[str] = mapped_column(Text, nullable=False)
    confirmed_at: Mapped[object] = mapped_column(DateTime, default=now_utc, nullable=False)
    expires_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (Index("ix_restrictions_active", "status", "expires_at"),)

class RoutePlan(Base, Stamp):
    __tablename__ = "route_plans"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    requested_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    geometry: Mapped[dict] = mapped_column(JSON, nullable=False)
    origin: Mapped[list] = mapped_column(JSON, nullable=False)
    destination: Mapped[list] = mapped_column(JSON, nullable=False)
    distance_m: Mapped[float] = mapped_column(Float, nullable=False)
    duration_s: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="candidate")
    evaluated_at: Mapped[object] = mapped_column(DateTime, default=now_utc, nullable=False)
    verified_by: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    verified_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)
    verification_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    __table_args__ = (Index("ix_routes_status", "status"),)

class EdgeNode(Base, Stamp):
    __tablename__ = "edge_nodes"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    stop_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("stops.id"), nullable=True)
    vehicle_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vehicles.id"), nullable=True)
    secret_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="camera", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[object | None] = mapped_column(DateTime, nullable=True)

class EdgeEvent(Base):
    __tablename__ = "edge_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    node_id: Mapped[str] = mapped_column(String(36), ForeignKey("edge_nodes.id"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(45), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    observed_at: Mapped[object] = mapped_column(DateTime, default=now_utc, nullable=False)
    received_at: Mapped[object] = mapped_column(DateTime, default=now_utc, nullable=False)

class RainReading(Base):
    __tablename__ = "rain_readings"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    source: Mapped[str] = mapped_column(String(150), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(300), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    mm: Mapped[float] = mapped_column(Float, nullable=False)
    period_hours: Mapped[int] = mapped_column(Integer, nullable=False)
    observed_at: Mapped[object] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[object] = mapped_column(DateTime, default=now_utc)
    __table_args__ = (Index("ix_rain_location_time", "observed_at", "lat", "lon"),)

class RiskZone(Base, Stamp):
    __tablename__ = "risk_zones"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    radius_m: Mapped[int] = mapped_column(Integer, nullable=False)
    susceptibility: Mapped[int] = mapped_column(Integer, nullable=False)
    critical_access: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source: Mapped[str] = mapped_column(String(180), nullable=False)
    source_version: Mapped[str] = mapped_column(String(120), nullable=False)
    __table_args__ = (CheckConstraint("susceptibility BETWEEN 0 AND 5", name="risk_zone_susceptibility"),)

class RiskAssessment(Base):
    __tablename__ = "risk_assessments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    zone_id: Mapped[str] = mapped_column(String(36), ForeignKey("risk_zones.id"), nullable=False)
    score: Mapped[int] = mapped_column(Integer, nullable=False)
    category: Mapped[str] = mapped_column(String(24), nullable=False)
    reasons: Mapped[list] = mapped_column(JSON, nullable=False)
    evaluated_at: Mapped[object] = mapped_column(DateTime, default=now_utc)
    rule_version: Mapped[str] = mapped_column(String(30), default="risk-v1")

class ResponseAsset(Base, Stamp):
    __tablename__ = "response_assets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    code: Mapped[str] = mapped_column(String(70), unique=True, nullable=False)
    asset_type: Mapped[str] = mapped_column(String(60), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lon: Mapped[float] = mapped_column(Float, nullable=False)
    state: Mapped[str] = mapped_column(String(24), default="available")

class ResponseDecision(Base):
    __tablename__ = "response_decisions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("response_assets.id"), nullable=False)
    zone_id: Mapped[str] = mapped_column(String(36), ForeignKey("risk_zones.id"), nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    approved_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    decided_at: Mapped[object] = mapped_column(DateTime, default=now_utc)

class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(90), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(45), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[object] = mapped_column(DateTime, default=now_utc)

class DomainEvent(Base):
    __tablename__ = "domain_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[object] = mapped_column(DateTime, default=now_utc)
    __table_args__ = (Index("ix_events_created_at", "created_at"),)


class KioskTicket(Base):
    __tablename__ = "kiosk_tickets"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    assistance_id: Mapped[str] = mapped_column(String(36), ForeignKey("assistances.id"), nullable=False)
    secret_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[object] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[object] = mapped_column(DateTime, default=now_utc, nullable=False)


class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    expires_at: Mapped[object] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[object] = mapped_column(DateTime, default=now_utc, nullable=False)
