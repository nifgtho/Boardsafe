"""Optional REAL Open-Meteo forecast adapter. Forecast is not official warning/observation."""
from datetime import datetime,timezone,timedelta
import httpx
from app.config import get_settings

class WeatherProviderError(Exception):
    pass

def forecast_24h(lat:float,lon:float):
    if not get_settings().open_meteo_enabled:
        raise WeatherProviderError("Open-Meteo está deshabilitado. Revise su licencia y configure BOARDSAFE_OPEN_METEO_ENABLED.")
    try:
        response=httpx.get("https://api.open-meteo.com/v1/forecast",params={
            "latitude":lat,"longitude":lon,"hourly":"precipitation","forecast_days":2,"timezone":"UTC"
        },timeout=12.0,follow_redirects=False,headers={"User-Agent":"BoardSafe-WFEO/1.0 (operations; license subject to provider terms)"})
        response.raise_for_status()
        data=response.json()["hourly"]
        hours=data["time"]
        mm=data["precipitation"]
        start=datetime.now(timezone.utc).replace(tzinfo=None)
        stop=start+timedelta(hours=24)
        values=[float(mm[i]) for i,t in enumerate(hours) if start <= datetime.fromisoformat(t).replace(tzinfo=None)<stop and mm[i] is not None]
    except (httpx.HTTPError,KeyError,IndexError,TypeError,ValueError) as exc:
        raise WeatherProviderError("No fue posible recuperar un pronóstico meteorológico válido") from exc
    if not values:raise WeatherProviderError("El pronóstico no tiene valores próximos")
    return {"source":"Open-Meteo", "source_ref":f"forecast:model:utc:{start:%Y%m%d%H}:{lat:.4f}:{lon:.4f}",
       "kind":"forecast","lat":lat,"lon":lon,"mm":round(sum(values),2),"period_hours":len(values),"observed_at":start}
