export type UserAccount = {
  userId: string;
  fullName: string;
  email: string;
  establishmentId: string;
  establishmentName: string;
  establishmentSlug: string;
  establishmentTimezone: string;
  role: 'owner' | 'receptionist' | 'professional';
  isPlatformAdmin: boolean;
};

type ApiError = { error?: string };

export class ApiResponseError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers }
  });

  if (!response.ok) {
    let message = 'Não foi possível conectar. Tente novamente.';
    try {
      const body = await response.json() as ApiError;
      if (body.error) message = body.error;
    } catch { /* Resposta não JSON. */ }
    throw new ApiResponseError(message, response.status);
  }

  return response.status === 204 ? (undefined as T) : await response.json() as T;
}

