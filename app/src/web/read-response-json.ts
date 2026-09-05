export async function readResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      res.ok ? "сервер вернул пустой ответ" : "не удалось сохранить: пустой ответ сервера",
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("сервер вернул не JSON");
  }
}
