interface ApiError {
  error?: string;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof body === "object" && body !== null ? (body as ApiError).error : undefined;
    throw new Error(message ?? "The request could not be completed");
  }
  return body as T;
}
