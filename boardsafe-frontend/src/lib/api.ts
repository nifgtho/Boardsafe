const API_BASE =
  process.env.NEXT_PUBLIC_BOARDSAFE_API_URL ?? "http://127.0.0.1:8000/api/v1";

export class BoardSafeError extends Error {
  status: number;
  reasons: string[];
  actionHint: string;

  constructor(
    status: number,
    message: string,
    reasons: string[] = [],
    actionHint = ""
  ) {
    super(message);
    this.name = "BoardSafeError";
    this.status = status;
    this.reasons = reasons;
    this.actionHint = actionHint;
  }
}

function getHint(status: number): string {
  switch (status) {
    case 401:
      return "Verifica tu correo y contraseña o vuelve a iniciar sesión.";
    case 403:
      return "Tu rol actual no tiene permisos para realizar esta acción.";
    case 404:
      return "El recurso solicitado no existe.";
    case 409:
      return "Hay una regla operativa que impide esta acción. Revisa los motivos e intenta una alternativa.";
    case 422:
      return "Revisa los datos ingresados (por ejemplo, contraseña de mínimo 12 caracteres).";
    case 429:
      return "Se alcanzó el límite temporal de envíos. Espera unos minutos.";
    case 503:
      return "Servicio externo no disponible temporalmente. No se mostrarán estimaciones sin verificar.";
    default:
      return "Si el problema continúa, contacta al operador de soporte.";
  }
}

export async function apiRequest<T = unknown>(
  path: string,
  options: {
    token?: string | null;
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const { token, method = "GET", body, signal } = options;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new BoardSafeError(
      0,
      "No se pudo conectar con el servidor BoardSafe.",
      [],
      "Comprueba tu conexión o contacta al responsable del servicio."
    );
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text };
    }
  }

  if (!res.ok) {
    const detail = (data as { detail?: unknown })?.detail;
    let message = `Error ${res.status}`;
    let reasons: string[] = [];

    if (typeof detail === "string") {
      message = detail;
    } else if (Array.isArray(detail)) {
      message = "Hay campos incompletos o con formato inválido.";
      reasons = detail.map((d: { loc?: unknown[]; msg?: string }) => {
        const field = Array.isArray(d.loc) ? d.loc.slice(1).join(".") : "campo";
        return `${field}: ${d.msg ?? "valor inválido"}`;
      });
    } else if (detail && typeof detail === "object") {
      const obj = detail as { message?: string; reasons?: string[] };
      message = obj.message ?? "Conflicto de regla operativa.";
      if (Array.isArray(obj.reasons)) reasons = obj.reasons;
    }

    throw new BoardSafeError(res.status, message, reasons, getHint(res.status));
  }

  return data as T;
}
